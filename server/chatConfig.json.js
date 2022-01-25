module.exports = {
    "data": {
        "type": "mysql", // Currently only MySQL servers are supported for data storage.
        "host": "127.0.0.1",
        "user": "root",
        "pass": "Example123"
    },
    "maxMessageLength": 2000, // How long can the message be?
    "port": 6060, // The port the server should run on
    "maxFileSizeKB": 16384, // Max file size in kilobytes
}