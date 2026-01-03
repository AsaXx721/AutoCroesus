
import { handleLootCommand, logLoot } from "./extra/lootLogs"
import { printHelp } from "./util/help_command"
import logger from "./util/logger"
import { addAlwaysBuy, addWorthlessItem, alwaysBuy, initAlwaysBuy, initWorthless, loadAlwaysBuy, loadWorthless, updatePrices, worthless } from "./util/prices"
import {
    acPogObj,
    appendToFile,
    CHEST_REGEX,
    findUnopenedChest,
    formatNumber,
    formattedBool,
    getCurrPage,
    getFormattedNameFromId,
    inCroesus,
    inRunGui,
    isInvLoaded,
    parseRewards,
    sortChestData,
    tryClickCroesus
} from "./util/utils"

if (!FileLib.exists("AutoCroesus", "data/always_buy.txt")) {
    initAlwaysBuy()
}
loadAlwaysBuy()

if (!FileLib.exists("AutoCroesus", "data/worthless.txt")) {
    initWorthless()
}
loadWorthless()

// Global variable spam yay!
let autoClaiming = false
let failedIndexes = [] // Indexes of chests which could not be claimed automatically.
let loggedIndexes = []
let currChestData = null // Stored globally for overlay

let chestClaimInfo = null // {page: 1, runSlot: 10, chestSlot:10} chestSlot can be null, other fields cannot

let waitingForCroesus = false // Waiting for croesus to open, no spam clicking!
let waitingForRunToOpen = false
let waitingForChestToOpen = false // Prevents spam clicking
let lastPageOn = null // More spam click prevention!
let waitingOnPage = null

let tryingToKismet = false
let canKismet = true // Flips to false if kismetting is enabled but no kismets are available

let lastClick = null
let indexToClick = null // Store this to allow for click speed throttling

register("tick", () => {
    if (indexToClick == null || Date.now() - lastClick < acPogObj.minClickDelay) return

    const inv = Player.getContainer()
    if (inv.getSize() <= indexToClick) return

    lastClick = Date.now()

    // Debug
    if (acPogObj.noClick) {
        ChatLib.chat(`Click ${indexToClick}`)
        indexToClick = null
        return
    }

    inv.click(indexToClick)
    indexToClick = null

})

register("tick", () => {
    if (!autoClaiming || waitingForCroesus) return

    const inv = Player.getContainer()
    if (inv && inv.getSize() > 45) return

    if (waitingForRunToOpen || waitingForChestToOpen) {
        ChatLib.chat(`Sequence out of sync, stopping. waitingForRun: ${waitingForRunToOpen} waitingCroesus: ${waitingForCroesus} lastPageOn: ${lastPageOn}`)
        reset()
        return
    }

    startClaiming()
})

// Logic for inside of the main Croesus menu
register("tick", () => {
    if (!inCroesus()) return

    if (!autoClaiming || waitingForRunToOpen) return

    waitingForCroesus = false
    // Don't reset for chest keys
    if (!chestClaimInfo) {
        currChestData = []
    }

    const inv = Player.getContainer()
    const items = inv.getItems()
    const page = getCurrPage()

    if (page == null || waitingOnPage !== null && page !== waitingOnPage) return

    // chestClaimInfo is already set, which means we're coming back from opening another chest (probably using a chest key or kismet)
    if (chestClaimInfo && chestClaimInfo.runSlot !== null) {

        // Try to get to the correct page
        if (page !== chestClaimInfo.page) {
            if (lastPageOn == page) return

            lastPageOn = page
            indexToClick = 53
            return
        }

        // We're on the right page now
        lastPageOn = null
        indexToClick = chestClaimInfo.runSlot
        waitingForRunToOpen = true
        return
    }

    // Search for unopened chests
    const [slotIndex, floor] = findUnopenedChest(inv, failedIndexes, page, canKismet)

    if (slotIndex) {
        chestClaimInfo = {
            floor,
            page: page,
            runSlot: slotIndex,
            chestSlot: null,
            skipKismet: false, // Used when a chest has already been rerolled
        }

        logger.push(`Clicking unopened chest at slot index ${slotIndex} (${slotIndex % 54})`)
        waitingForRunToOpen = true
        indexToClick = slotIndex
        return
    }

    if (items[53] && items[53].getType().getName().removeFormatting().includes("Arrow")) {
        if (lastPageOn == page) return

        logger.push("Moving to next page")
        lastPageOn = page
        indexToClick = 53
        waitingOnPage = page + 1
        return
    }

    logger.push("All done!")
    ChatLib.chat(`&aAll chests looted!`)
    logger.write()
    reset()
    Client.currentGui.close()
})

register("tick", () => {
    if (!autoClaiming && !acPogObj.showChestInfo) {
        reset()
        return
    }

    const inv = Player.getContainer()

    if (!inRunGui()) {
        if (!chestClaimInfo) {
            currChestData = null
        }
        return
    }

    if (!isInvLoaded(inv)) return
    if (waitingForChestToOpen) return

    waitingForRunToOpen = false
    lastPageOn = null
    waitingOnPage = null

    if (chestClaimInfo && chestClaimInfo.chestSlot !== null) {
        waitingForChestToOpen = true
        indexToClick = chestClaimInfo.chestSlot
        logger.push(`Clicking ${indexToClick} early and returning`)
        chestClaimInfo.chestSlot = null
        return
    }


    const items = inv.getItems()
    const chestData = []

    // Find the chest items and parse the loot shown in their tooltips
    for (let i = 0; i < 27; i++) {
        let item = items[i]

        if (!item) continue

        let match = item.getName().removeFormatting().match(CHEST_REGEX)
        if (!match) {
            // No spamming logs
            if (autoClaiming) {
                logger.push(`index ${i} does not match chest regex: "${item.getName()}"`)
            }

            continue
        }

        let [color, chestName] = match

        let lore = item.getLore()
        let lootEnd = (lore.findIndex(line => String(line).removeFormatting().includes("Cost"))) - 1
        let chestFormatted = `${color}${chestName}`

        // No spamming logs
        if (autoClaiming) {
            logger.push(`Chest Name: "${chestName}", Formatted: "${chestFormatted}", lootEnd: ${lootEnd}\nLore:\n    ${lore.join("\n    ")}`)
        }


        if (!lootEnd) {
            // No spamming logs
            if (autoClaiming) {
                logger.push(`Loot end not found`)
            }

            ChatLib.chat(`&cCould not find loot end!`)
            reset()
            return
        }

        let costInd = lore.findIndex(line => String(line).includes("Cost"))

        // No spamming logs
        if (autoClaiming) {
            logger.push(`Cost index is ${costInd}`)
        }

        if (!costInd) {
            ChatLib.chat(`&cCould not find cost index!`)
            reset()
            return
        }

        // All of the annoying item and cost parsing is done here
        let [success, rewardData] = parseRewards(lore.slice(2, lootEnd), lore[costInd + 1])

        if (!success) {
            if (chestClaimInfo) {
                if (autoClaiming) {
                    logger.push(`Failed to check this chest: ${rewardData}`)
                }
                ChatLib.chat(`Failed to check ${chestFormatted} Chest: &r${rewardData}\n&eThis run will be skipped as the info for this chest is incomplete.`)
                failedIndexes.push(chestClaimInfo.runSlot + (chestClaimInfo.page - 1) * 54)
                chestClaimInfo = null
                // Go back to main croesus menu
                indexToClick = 30
            }
            return
        }

        rewardData.slot = i

        rewardData.chestName = chestName
        rewardData.chestColor = color

        chestData.push(rewardData)
    }
    sortChestData(chestData)

    currChestData = chestData

    if (!autoClaiming) return
    if (!chestClaimInfo) return ChatLib.chat('nieger')
    const bedrockChest = chestData.find(a => a.chestName == "Bedrock") ?? null
    const hasAlwaysBuyItem = bedrockChest && bedrockChest.items.some(a => alwaysBuy.has(a.id))

    if (!hasAlwaysBuyItem && !chestClaimInfo.skipKismet && acPogObj.useKismets && bedrockChest !== null && acPogObj.kismetFloors.includes(chestClaimInfo.floor)) {
        const profit = bedrockChest.profit
        if (profit < acPogObj.kismetMinProfit) {
            tryingToKismet = true
            indexToClick = bedrockChest.slot
            waitingForChestToOpen = true
            return
        }
    }

    ChatLib.chat(`Claiming the ${chestData[0].chestColor}${chestData[0].chestName} Chest. Profit: ${chestData[1].profit}`)

    const chestsToClaim = [chestData[0]]
    if (chestData[1].profit >= acPogObj.chestKeyMinProfit && acPogObj.useChestKeys) {
        ChatLib.chat(`Using chest key on the ${chestData[1].chestColor}${chestData[1].chestName} Chest`)
        chestClaimInfo.chestSlot = chestData[1].slot
        chestsToClaim.push(chestData[1])
    }

    // Log the loot for this floor
    const runIndex = chestClaimInfo.runSlot + (chestClaimInfo.page - 1) * 54
    if (!loggedIndexes.includes(runIndex)) {
        // ChatLib.chat(`Logged loot for page ${chestClaimInfo.page} run slot ${chestClaimInfo.runSlot}`)
        loggedIndexes.push(runIndex)
        logLoot(chestClaimInfo.floor, chestsToClaim, chestData.length)
    }

    const toClick = chestData[0].slot
    indexToClick = toClick
    waitingForChestToOpen = true
    failedIndexes.push(chestClaimInfo.runSlot + (chestClaimInfo.page - 1) * 54)
})

register("tick", () => {
    if (!waitingForChestToOpen) return
    const inv = Player.getContainer()

    if (!isInvLoaded(inv) || inv.getSize() < 32) return
    const match = String(inv.getName()).removeFormatting().match(/^(\w+) Chest$/)

    if (!match) return

    const chestName = match[1]

    waitingForChestToOpen = false

    const items = inv.getItems()
    if (tryingToKismet && chestName == "Bedrock" && !chestClaimInfo.skipKismet) {
        const kismetSlot = items[50]
        tryingToKismet = false

        if (!kismetSlot || String(kismetSlot.getName()).removeFormatting() !== "Reroll Chest" || String(kismetSlot.getLore()).removeFormatting().includes("Bring a Kismet Feather")) {
            canKismet = false
            ChatLib.chat(`&cCould not find kismets. Auto claiming for ${chestClaimInfo.floor} is disabled until kismetting is turned off or kismets are available to use.`)
            failedIndexes.push(chestClaimInfo.chestSlot + (chestClaimInfo.page - 1) * 54)
            chestClaimInfo = null
            Client.currentGui.close()
            return
        }

        if (String(kismetSlot.getLore()).removeFormatting().includes("You already rerolled a chest!")) {
            ChatLib.chat(`&eAlready rerolled!`)
            chestClaimInfo.skipKismet = true
            indexToClick = 49
            waitingForRunToOpen = true
            return
        }

        chestClaimInfo.skipKismet = true
        indexToClick = 50
        return
    }

    indexToClick = 31

    // We're done looting this run (Unless using a chest key)
    if (chestClaimInfo.chestSlot === null) {
        chestClaimInfo = null
    }
})

const reset = () => {
    chestClaimInfo = null
    autoClaiming = false

    waitingForCroesus = false
    waitingForRunToOpen = false
    waitingForChestToOpen = false
    lastPageOn = null
    waitingOnPage = null

    indexToClick = null
    tryingToKismet = false
    canKismet = true
    failedIndexes = []
}

const startClaiming = () => {
    autoClaiming = true

    if (!tryClickCroesus()) {
        autoClaiming = false
        ChatLib.chat(`Could not click Croesus (Too far away?)`)
        reset()
        return
    }

    waitingForCroesus = true
}

const updateApiData = (onDone = null) => {
    updatePrices().then(() => {
        ChatLib.chat(`&aSuccessfully grabbed data from API!`)
        acPogObj.lastApiUpdate = Date.now()
        if (onDone) {
            onDone()
        }
    }).catch((reason) => {
        logger.write()
        ChatLib.chat(`&cFailed to grab data from API: ${reason}`)
        ChatLib.chat(`&cTo try again, run //ac api`)
        ChatLib.chat(`&eIf this keeps happening, contact UnclaimedBloom6 on Discord.`)
    })
}

const printSettings = () => {
    const kismetFloorsFormatted = acPogObj.kismetFloors.map(floor => {
        if (floor.startsWith("M")) {
            return "&c&l" + floor + "&r"
        }
        return "&a" + floor + "&r"
    })

    ChatLib.chat(`&b&lAutoCroesus &aSettings`);
    ChatLib.chat(`&7Commands to change settings are shown in brackets.`);
    ChatLib.chat(`  Chest Info Overlay: ${formattedBool(acPogObj.showChestInfo)} &8(//ac overlay)`);
    ChatLib.chat("");
    ChatLib.chat(`  Min Click Delay: &6${acPogObj.minClickDelay}ms &8(//ac delay <ms>)`);
    ChatLib.chat(`  &cWarning: Low values with low ping will make this module ZOOM. Be safe!`);
    ChatLib.chat("");
    ChatLib.chat(`  Use Chest Keys: ${formattedBool(acPogObj.useChestKeys)} &8(//ac key)`);
    ChatLib.chat(`  Min Chest Key Profit: &6${formatNumber(acPogObj.chestKeyMinProfit)} &8(//ac key <min_profit>)`);
    ChatLib.chat("");
    ChatLib.chat(`  Use Kismets: ${formattedBool(acPogObj.useKismets)} &8(//ac kismet)`);
    ChatLib.chat(`  Min Kismet Profit: &6${formatNumber(acPogObj.kismetMinProfit)} &8(//ac kismet <min_profit>)`);
    ChatLib.chat(`  Kismet Floors: &a${kismetFloorsFormatted.join(", ") || "&cNONE"} &8(//ac kismet <floor>)`);
}

register("command", (...args) => {
    if (!args || !args[0]) {
        printHelp()
        return
    }

    if (args[0] == "reset") {
        reset()
        ChatLib.chat(`Reset!`)
    }

    // if (args[0] == "loot") {
    //     handleLootCommand(...args)
    //     return
    // }

    if (args[0] == "settings" || args[0] == "config" || args[0] == "s" || args[0] == "c") {
        printSettings()
        return
    }

    if (args[0] == "delay") {
        const delay = parseInt(args[1])
        if (isNaN(delay)) {
            ChatLib.chat(`//ac delay <ms>`)
            return
        }

        acPogObj.minClickDelay = delay
        ChatLib.chat(`Min Click Delay is now &6${delay}ms`)

        if (delay < 150) {
            ChatLib.chat(`&cWarning: Setting the delay to a low value with low ping will claim chests so quickly that people in chat might notice. Be careful setting this so low.`)
        }

        return
    }

    if (args[0] == "kismet" || args[0] == "reroll") {
        // Add/remove floors to kismet on
        const isFloor = /^[fFmM][1-7]$/.test(args[1])
        if (isFloor) {
            const upper = args[1].toUpperCase()
            const existingInd = acPogObj.kismetFloors.indexOf(upper)
            if (existingInd !== -1) {
                acPogObj.kismetFloors.splice(existingInd, 1)
                ChatLib.chat(`Removed ${upper} from kismet floors`)
                return
            }
            acPogObj.kismetFloors.push(upper)
            ChatLib.chat(`Added ${upper} to kismet floors`)
            return
        }

        // Change kismet min profit
        let value = parseInt((args[1] ?? "").replace(/[,._]/g, ""))
        if (!isNaN(value)) {
            acPogObj.kismetMinProfit = value
            ChatLib.chat(`Min kismet profit is now ${formatNumber(value)}`)
            return
        }

        // Toggle using kismets
        acPogObj.useKismets = !acPogObj.useKismets
        ChatLib.chat(`Use Kismets is now ${formattedBool(acPogObj.useKismets)}`)
    }

    if (args[0] == "key" || args[0] == "chestkey") {
        let value = parseInt(args[1]?.replace(/[,_]/g, ""))
        if (!isNaN(value)) {
            acPogObj.chestKeyMinProfit = value
            ChatLib.chat(`Min chest key profit is now ${formatNumber(value)}`)
            return
        }

        acPogObj.useChestKeys = !acPogObj.useChestKeys
        ChatLib.chat(`Use Chest Keys is now ${formattedBool(acPogObj.useChestKeys)}`)
    }

    if (args[0] == "go") {
        const sinceUpdate = Date.now() - acPogObj.lastApiUpdate
        logger.clear()

        // Updated recently enough
        if (sinceUpdate <= 1_800_000) {
            autoClaiming = true
            return
        }

        logger.push("Updating prices from API")
        ChatLib.chat(`&ePrices have not been updated in over 30 minutes. Grabbing data...`)

        updateApiData(() => {
            logger.push("Successfully updated prices, starting to claim now")
            autoClaiming = true
        })
    }

    if (args[0] == "forcego") {
        ChatLib.chat(`&aClaiming without updating API.`)
        autoClaiming = true
        return
    }

    if (args[0] == "api") {
        ChatLib.chat(`&aGrabbing data...`)
        updateApiData()
        return
    }

    if (args[0] == "alwaysbuy") {
        if (!args[1]) {
            ChatLib.chat(`&b&lAlways Buy Items:`);
            for (let id of alwaysBuy) {
                let formattedName = getFormattedNameFromId(id) ?? "&c&lUNKNOWN ITEM"
                ChatLib.chat(`  ${formattedName}`);
            }
            return
        }

        if (args[1] == "reset") {
            ChatLib.chat(`&aResetting the list of items to always buy to their defaults.`)
            initAlwaysBuy()
            loadAlwaysBuy()
            return
        }

        addAlwaysBuy(args[1])
        return
    }

    if (args[0] == "worthless") {
        if (!args[1]) {
            ChatLib.chat(`&b&lWorthless Items:`);
            for (let id of worthless) {
                let formattedName = getFormattedNameFromId(id) ?? "&c&lUNKNOWN ITEM"
                ChatLib.chat(`  ${formattedName}`);
            }
            return
        }

        if (args[1] == "reset") {
            ChatLib.chat(`&aResetting the list of worthless items to their defaults.`)
            initWorthless()
            loadWorthless()
            return
        }

        addWorthlessItem(args[1])
        return
    }

    if (args[0] == "noclick") {
        acPogObj.noClick = !acPogObj.noClick
        ChatLib.chat(`No Click is now set to ${formattedBool(acPogObj.noClick)}`)
        return
    }

    if (args[0] == "copy") {
        logger.copy()
        ChatLib.chat(`&aCopied AutoCroesus log to clipboard. (${logger.str.length} chars)`)
        return
    }

}).setName("autocroesus").setAliases("/ac")

const killSwitchKeys = [
    Keyboard.KEY_LSHIFT,
    Keyboard.KEY_ESCAPE,
]

// Kill switch
register("tick", () => {
    if (!autoClaiming) return

    if (killSwitchKeys.some(a => Keyboard.isKeyDown(a))) {
        reset()
        ChatLib.chat(`Kill switch activated!`)
    }
})
