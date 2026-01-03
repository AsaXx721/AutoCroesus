export const printHelp = () => {
    ChatLib.chat(" ")
    ChatLib.chat("&b&lAuto Croesus &aCommands");
    ChatLib.chat("&a//ac &8- &7Show help.");
    ChatLib.chat("&a//ac go &8- &7Start looting.");
    ChatLib.chat("&a//ac forcego &8- &7Start without API check.");
    ChatLib.chat("&a//ac api &8- &7Refresh API.");
    ChatLib.chat("&a//ac settings &8- &7View settings.");
    ChatLib.chat("&a//ac delay <ms> &8- &7Set click delay.");
    //ChatLib.chat("&a//ac loot [floor] [limit] [score] &8- &7Show collected loot.");
    ChatLib.chat("");
    ChatLib.chat("&a//ac kismet &8- &7Toggle rerolls.");
    ChatLib.chat("&a//ac kismet <min_profit> &8- &7Configure how much profit is required for the chest to not be rerolled. Eg 2,000,000 would mean any chest with >=2m profit will not be rerolled.");
    ChatLib.chat("&a//ac kismet <floor> &8- &7Toggle floor for rerolls.");
    ChatLib.chat("&a//ac key &8- &7Toggle chest keys.");
    ChatLib.chat("&a//ac key <min_profit> &8- &7Set min profit for keys.");
    ChatLib.chat("");
    ChatLib.chat("&a//ac alwaysbuy [id|reset] &8- &7Manage always-buy items.");
    ChatLib.chat("&a//ac worthless [id|reset] &8- &7Manage worthless items.");
    ChatLib.chat(" ")
}