const express = require('express');
const http = require('http');
const fs = require("fs");
const { Server } = require("socket.io");

var config = require("./chatConfig.json");

/* Setting up web server & socket.io */
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    "pingTimeout": 120*1000,
    "maxHttpBufferSize": (1024*1024) + (config.maxFileSizeKB*1024)
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

/* As you might've guessed, the emoji route */
app.get('/emojis/:emoji', (req, res) => {
    res.sendFile(__dirname + "/emojis/" + req.params.emoji + ".png");
});

/* Download a file with the given id */
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
  
    res.writeHead(200, { /* Set headers for file download */
        'Content-Disposition': `attachment; filename="${uploads[req.query.id].name}"`,
        'Content-Type': 'text/plain',
    });

    res.end(fileContents); /* Send file contents */
});

app.get('/socketio.js', (req, res) => { /* Provide socket.io client library */
    res.sendFile(__dirname + '/socketio.js');
});

var connectedUsers = {}; // Object of connected user objects
var messages = {}; // Object of messages

var uploads = {}; // Object including all uploaded files

io.on('connection', (socket) => {
    socket.uniqueId = idGenNum();

    connectedUsers[socket.uniqueId] = { /* Add the user with username pending */
        "username": "Pending",
        "id": socket.uniqueId,
        "isAdmin": false,
        "connected": true,
    };

    io.emit("emit message", { /* Notify all clients that a new user is here! */
        "mid": systemBotId(),
        "from": "System-Bot",
        "isAdmin": true,
        "message": "A new user connected! (ID: " + socket.uniqueId + ")"
    });

    io.emit("update users", Object.values(connectedUsers).filter((val) => val.connected));

    socket.on("disconnect", (reason) => {
        console.log(socket.uniqueId + " disconnect: " + reason);
        connectedUsers[socket.uniqueId].connected = false; /* Set the connected value to false */

        io.emit("emit message", { /* Notify all clients that this user disconnected */
            "mid": systemBotId(),
            "from": "System-Bot",
            "isAdmin": true,
            "message": "User ID " + socket.uniqueId + (connectedUsers[socket.uniqueId].username == "Pending" ? "" : " (" +connectedUsers[socket.uniqueId].username + ") ") + "has disconnected :("
        });

        io.emit("update users", Object.values(connectedUsers).filter((val) => val.connected));
    });

    socket.on("set username", (data, ret) => { // Received when user does /username
        if(typeof(data) == "string") { // Check if the data is even a string
            if(data.length > config.maxUsernameLength) { // Check the length
                ret("TOO_LONG");
                return;
            }

            /* Check if the name is already taken */
            Object.values(connectedUsers).forEach((user) => {
                if(user.connected) {
                    if(user.username == data) {
                        ret("NAME_TOOK");
                        return;
                    }
                }
            });

            /* Notify all clients that the user changed his name */
            io.emit("emit message", {
                "mid": systemBotId(),
                "from": "System-Bot",
                "isAdmin": true,
                "message": (connectedUsers[socket.uniqueId].username == "Pending" ? "User with ID " + socket.uniqueId : connectedUsers[socket.uniqueId].username) + " changed his name to " + data.replace(/<\/?[^>]+(>|$)/g, "")
            });

            /* Actually apply the change */
            connectedUsers[socket.uniqueId].username = data.replace(/<\/?[^>]+(>|$)/g, ""); // Remove HTML tags

            ret("OK");
        }else {
            ret("ERROR");
        }
    });

    socket.on("verify admin", (data, ret) => { // login code
        if(data == config.adminPassword) {
            io.emit("emit message", { // Notify all clients that an user is now an admin
                "mid": systemBotId(),
                "from": "System-Bot",
                "isAdmin": true,
                "message": (connectedUsers[socket.uniqueId].username == "Pending" ? "User with ID " + socket.uniqueId : connectedUsers[socket.uniqueId].username) + " is now logged in as an admin."
            });

            connectedUsers[socket.uniqueId].isAdmin = true; // Set the admin status
            ret("OK");
            return;
        }

        ret("ERROR");
    })

    socket.on("get online", (data, ret) => {
        ret(Object.values(connectedUsers).filter((val) => val.connected)); // Get a list of users that still are connected
    });

    socket.on("get config", async (ret) => { // Returns a trimmed version of the config
        ret({
            "allowBold": config.allowBold,
            "allowImages": config.allowImages,
            "allowLinks": config.allowLinks,
            "maxMessageLength": config.maxMessageLength,
            "maxUsernameLength": config.maxUsernameLength,
            "maxFileSizeKB": config.maxFileSizeKB
        });

        await socket.emit("update users", Object.values(connectedUsers).filter((val) => val.connected)); // Send users

        socket.emit("emit old", Object.values(messages).map((val, index) => { return { // After user has requested the config, send him the old messages. This is becuase
            "mid": val.mid,                                                            // the client can't handle old messages before that.
            "from": val.from,
            "message": val.message,
            "isAdmin": connectedUsers[val.fromId].isAdmin,
            "time": val.time
        }}));
    });

    socket.on("send message", (data, ret) => {
        if(connectedUsers[socket.uniqueId].username == "Pending") { // Check if user has already done /username
            ret("NO_USERNAME");
            return;
        }

        if(data.length < 1 || data.length > config.maxMessageLength) { // Check message length
            ret("MSG_LEN");
            return;
        }

        // Remove HTML tags from message
        var sanitized = data;
        
        if(!connectedUsers[socket.uniqueId].isAdmin) {
            sanitized = data.replace(/<\/?[^>]+(>|$)/g, "");
        }

        var message = {
            "mid": idGenNum(),
            "from": connectedUsers[socket.uniqueId].username,
            "fromId": socket.uniqueId,
            "message": sanitized,
            "time": Date.now()
        };

        // Add it to the message history & send it
        messages[message.mid] = message;
        io.emit("emit message", message);

        ret("OK");
    });

    socket.on("send file", (data, ret) => {
        if(data.name.length > 128) { // Check if the file name exceeds 128 characters
            ret("FILE_NAME_TOO_LONG");
        }

        if(data.content.length > config.maxFileSizeKB*1024) { // Check the file size
            ret("FILE_TOO_LARGE");
        }

        var id = idGen(); // Generate an id
        var buf = Buffer.from(data.content); // Generate a buffer from the data sent

        // Add the upload to the uploads object
        uploads[id] = {
            "name": data.name,
            "content": buf,
            "from": connectedUsers[socket.uniqueId].username,
            "fromId": socket.uniqueId,
            "time": Date.now(),
            "size": buf.byteLength
        }

        // Also send a message
        var message = {
            "mid": idGenNum(),
            "from": connectedUsers[socket.uniqueId].username,
            "fromId": socket.uniqueId,
            "message": `<div class="download" onclick="window.location.href = '/download?id=${id}';">
                            <p style="font-size: 20px; margin-bottom: 0px; margin-top: 0px;">Download (${Math.floor(uploads[id].size/1024)}kb)</p>
                            <p style="font-size: 14px; margin-top: -5px; text-overflow: ellipsis; max-width: 180px;">${data.name}</p>
                        </div>`
        }

        messages[message.mid] = message;
        io.emit("emit message", message);

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

var nums = "0123456789";
function idGenNum(len = 8) {
    var res = "";

    for(var i = 0; i < len; i++) {
        res += alp[Math.floor(Math.random() * alp.length)];
    }

    return res;
}

function systemBotId() {
    return 1000000 + Math.floor(Math.random()*500000);
}