module.exports = {
    "allowBold": true,
    "allowImages": true,
    "allowLinks": true, // This will not block links, but will disable/enable highlighting of links when using [!LINK||TEXT] syntax
    "maxMessageLength": 2000,
    "maxUsernameLength": 20,
    "adminPassword": "example123", // Change this password!
    "port": 6060,
    "maxFileSizeKB": 16384 // Files are currently exclusively stored in RAM - do not make this limit too high or you will get an OOM error
}