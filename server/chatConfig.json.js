module.exports = {
    "allowBold": true, // Toggles the functionality to write text bold with this syntax: *my bold text*
    "allowImages": true, // Toggles the functionality to embed imaged with this syntax: [!LINK TO IMAGE]
    "allowLinks": true, // This will not block links, but will disable/enable highlighting of links when using [~LINK||TEXT] syntax
    "maxMessageLength": 2000, // How long can the message be?
    "maxUsernameLength": 20, // How long can the username be?
    "adminPassword": "example123", // VERY IMPORTANT => Change this password!
    "port": 6060, // The port the server should run on
    "maxFileSizeKB": 16384, // Max file size in kilobytes - files are currently exclusively stored in RAM - do not make this limit too high or you will get an OOM error
    "blockedPhrases": ["test blocked phrase"] // Blocked phrases - messages including them wont be sent
}