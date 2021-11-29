const express = require('express');
const http = require('http');
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.get('/socketio.js', (req, res) => {
    res.sendFile(__dirname + '/socketio.js');
});

var idCounter = 0;
var msgIdCounter = 0;

var connectedUsers = [];
var messages = [];
var config = JSON.parse(fs.readFileSync("chatConfig.json"))

io.on('connection', (socket) => {
    socket.uniqueId = idCounter;
    idCounter++;

    connectedUsers.push({
        "username": "Pending",
        "id": socket.uniqueId,
        "isAdmin": false,
        "connected": true,
    });

    socket.emit("emit old", messages.map((val) => { return {
        "from": val.from,
        "message": val.message,
        "isAdmin": connectedUsers[val.fromId].isAdmin,
    }}));

    io.emit("emit message", {
        "from": "System-Bot",
        "isAdmin": true,
        "message": "A new user connected! (ID: " + socket.uniqueId + ")"
    });


    socket.on("disconnect", (reason) => {
        connectedUsers[socket.uniqueId].connected = false;

        io.emit("emit message", {
            "from": "System-Bot",
            "isAdmin": true,
            "message": "User ID " + socket.uniqueId + " has disconnected :("
        });
    });

    socket.on("set username", (data, ret) => {
        if(typeof(data) == "string") {
            if(data.length > config.maxUsernameLength) {
                ret("TOO_LONG");
                return;
            }

            var nameTook = false;

            connectedUsers.forEach((user) => {
                if(user.connected) {
                    if(user.username == data) nameTook = true;
                }
            });

            if(nameTook) {
                ret("NAME_TOOK");
                return;
            }

            io.emit("emit message", {
                "from": "System-Bot",
                "isAdmin": true,
                "message": (connectedUsers[socket.uniqueId].username == "Pending" ? "User with ID " + socket.uniqueId : connectedUsers[socket.uniqueId].username) + " changed his name to " + data.replace(/<\/?[^>]+(>|$)/g, "")
            });

            connectedUsers[socket.uniqueId].username = data.replace(/<\/?[^>]+(>|$)/g, "");

            ret("OK");
        }else {
            ret("ERROR");
        }
    });

    socket.on("verify admin", (data, ret) => {
        if(data == config.adminPassword) {
            io.emit("emit message", {
                "from": "System-Bot",
                "isAdmin": true,
                "message": (connectedUsers[socket.uniqueId].username == "Pending" ? "User with ID " + socket.uniqueId : connectedUsers[socket.uniqueId].username) + " is now logged in as an admin."
            });

            connectedUsers[socket.uniqueId].isAdmin = true;
            ret("OK");
            return;
        }

        ret("ERROR");
    })

    socket.on("get online", (data, ret) => {
        ret(connectedUsers.filter((val) => val.connected).map((val) => {
            return {
                "username": val.username,
                "isAdmin": val.isAdmin,
            }
        }));
    });

    socket.on("get config", (ret) => {
        ret({
            "allowBold": config.allowBold,
            "allowImages": config.allowImages,
            "allowLinks": config.allowLinks,
            "maxMessageLength": config.maxMessageLength,
            "maxUsernameLength": config.maxUsernameLength
        });
    });

    socket.on("send message", (data, ret) => {
        if(connectedUsers[socket.uniqueId].username == "Pending") {
            ret("NO_USERNAME");
            return;
        }

        if(data.length < 1 || data.length > config.maxMessageLength) {
            ret("MSG_LEN");
            return;
        }

        msgIdCounter++;

        var sanitized = data;
        
        if(!connectedUsers[socket.uniqueId].isAdmin) {
            sanitized = data.replace(/<\/?[^>]+(>|$)/g, "");
        }

        messages.push({
            "id": msgIdCounter,
            "from": connectedUsers[socket.uniqueId].username,
            "fromId": socket.uniqueId,
            "message": sanitized
        });

        io.emit("emit message", {
            "from": connectedUsers[socket.uniqueId].username,
            "isAdmin": connectedUsers[socket.uniqueId].isAdmin,
            "message": sanitized
        });

        ret("OK");
    })
});

server.listen(config.port, () => {
    console.log(`EpicChat is now listening to port ${config.port}`);
});