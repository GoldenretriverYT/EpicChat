const express = require('express');
const http = require('http');
const fs = require("fs");
const { Server } = require("socket.io");

var config = require("./chatConfig.json");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    "pingTimeout": 120*1000,
    "maxHttpBufferSize": (1024*1024) + (config.maxFileSizeKB*1024)
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.get('/emojis/:emoji', (req, res) => {
    res.sendFile(__dirname + "/emojis/" + req.params.emoji + ".png");
  });

app.get('/download', (req, res) => {
    if(req.query.id == null) {
        res.status(400).send("Bad request");
        return;
    }

    if(uploads[req.query.id] == null) {
        res.status(404).send("Not found");
        return;
    }

    var fileContents = uploads[req.query.id].content;
  
    res.writeHead(200, {
        'Content-Disposition': `attachment; filename="${uploads[req.query.id].name}"`,
        'Content-Type': 'text/plain',
    });

    res.end(fileContents);
});

app.get('/socketio.js', (req, res) => {
    res.sendFile(__dirname + '/socketio.js');
});

var idCounter = 0;
var msgIdCounter = 0;

var connectedUsers = [];
var messages = [];

var uploads = {};

io.on('connection', (socket) => {
    socket.uniqueId = idCounter;
    idCounter++;

    connectedUsers.push({
        "username": "Pending",
        "id": socket.uniqueId,
        "isAdmin": false,
        "connected": true,
    });

    io.emit("emit message", {
        "mid": systemBotId(),
        "from": "System-Bot",
        "isAdmin": true,
        "message": "A new user connected! (ID: " + socket.uniqueId + ")"
    });


    socket.on("disconnect", (reason) => {
        console.log(socket.uniqueId + " disconnect: " + reason);
        connectedUsers[socket.uniqueId].connected = false;

        io.emit("emit message", {
            "mid": systemBotId(),
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
                "mid": systemBotId(),
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
                "mid": systemBotId(),
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
            "maxUsernameLength": config.maxUsernameLength,
            "maxFileSizeKB": config.maxFileSizeKB
        });

        socket.emit("emit old", messages.map((val, index) => { return {
            "mid": index,
            "from": val.from,
            "message": val.message,
            "isAdmin": connectedUsers[val.fromId].isAdmin,
            "time": val.time
        }}));
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
            "mid": msgIdCounter,
            "from": connectedUsers[socket.uniqueId].username,
            "fromId": socket.uniqueId,
            "message": sanitized,
            "time": Date.now()
        });

        io.emit("emit message", {
            "mid": msgIdCounter,
            "from": connectedUsers[socket.uniqueId].username,
            "isAdmin": connectedUsers[socket.uniqueId].isAdmin,
            "message": sanitized
        });

        ret("OK");
    });

    socket.on("send file", (data, ret) => {
        if(data.name.length > 128) {
            ret("FILE_NAME_TOO_LONG");
        }

        if(data.content.length > config.maxFileSizeKB*1024) {
            ret("FILE_TOO_LARGE");
        }

        var id = idGen();
        var buf = Buffer.from(data.content);

        uploads[id] = {
            "name": data.name,
            "content": buf,
            "from": connectedUsers[socket.uniqueId].username,
            "fromId": socket.uniqueId,
            "time": Date.now(),
            "size": buf.byteLength
        }

        msgIdCounter++;

        messages.push({
            "mid": msgIdCounter,
            "from": connectedUsers[socket.uniqueId].username,
            "fromId": socket.uniqueId,
            "message": `<div class="download" onclick="window.location.href = '/download?id=${id}';">
                            <p style="font-size: 20px; margin-bottom: 0px; margin-top: 0px;">Download (${Math.floor(uploads[id].size/1024)}kb)</p>
                            <p style="font-size: 14px; margin-top: -5px; text-overflow: ellipsis; max-width: 180px;">${data.name}</p>
                        </div>`
        });
        
        io.emit("emit message", {
            "mid": msgIdCounter,
            "from": connectedUsers[socket.uniqueId].username,
            "isAdmin": connectedUsers[socket.uniqueId].isAdmin,
            "message": `<div class="download" onclick="window.location.href = '/download?id=${id}';">
                            <p style="font-size: 20px; margin-bottom: 0px; margin-top: 0px;">Download (${Math.floor(uploads[id].size/1024)}kb)</p>
                            <p style="font-size: 14px; margin-top: -5px; text-overflow: ellipsis; max-width: 180px;">${data.name}</p>
                        </div>`
        });

        ret("OK");
    })
});

server.listen(config.port, () => {
    console.log(`EpicChat is now listening to port ${config.port}`);
});

var alp = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function idGen(len = 32) {
    var res = "";

    for(var i = 0; i < len; i++) {
        res += alp[Math.floor(Math.random() * alp.length)];
    }

    return res;
}

function systemBotId() {
    return 1000000 + Math.floor(Math.random()*500000);
}