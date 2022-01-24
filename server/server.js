const express = require('express');
const http = require('http');
const fs = require("fs");
const bcrypt = require("bcrypt");
const { Server } = require("socket.io");

var config = require("./chatConfig.json");

/*
  Users Struct:
    [
        userId: {
            "username": "<username>",
            "passwordHash": "<bcrypt password hash>",
            "role": "<roleId>",
            "authToken": "",
        }
    ]
*/
var users = JSON.parse(fs.readFileSync("users.json"));

/*
  Roles Struct:
    [
        roleId: {
            "roleName": "<role name>",
            "roleColor": "<hex color>",
            "permissions": ["write", "ban"]
        }
    ]
*/
var roles = JSON.parse(fs.readFileSync("roles.json"));

/*
    Messages Struct:
    [
        messageId: {
            "writtenBy": "<userId>",
            "content": "<content>",
            "writtenAt": "<timestamp>",
        }
    ]
*/
var messages = JSON.parse(fs.readFileSync("messages.json"));

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

app.get('/socketio.js', (req, res) => { /* Provide socket.io client library */
    res.sendFile(__dirname + '/socketio.js');
});

io.on('connection', (socket) => {
    socket.uniqueId = generateUID();
    socket.authToken = "not_logged_in";

    socket.on("update auth token", (data, answer) => {
        socket.authToken = data;
        answer({success: 1, data: {}});
    });

    socket.on("verify auth token", (data, answer) => {
        if(getUserIdBySocket(socket) == null) {
            answer({success: 0, data: "No matching user account was found"});
        }else {
            answer({success: 1, data: ""});
        }
    });

    socket.on("create account", (data, answer) => {
        if(!(username in data) || !(password in data)) {
            answer({success: 0, data: "No username/password provided"});
            return;
        }

        if(data.username.length < 3 || data.user.length > 20) {
            answer({success: 0, data: "Username too short or too long. (3-20 chars)"});
            return;
        }

        if(data.username.match(/([^A-Za-z0-9_])/g).length > 0) {
            answer({success: 0, data: "Username includes invalid characters (allowed: a-zA-Z0-9_)"});
            return;
        }

        if(data.password < 8) {
            answer({success: 0, data: "Your password is too short. At least 8 characters."});
            return;
        }

        bcrypt.hash(data.password).then((hash) => {
            users[generateUID()] = {
                
            }
        });
    })
});

server.listen(config.port, () => {
    console.log(`EpicChat is now listening to port ${config.port}`);
});

var alp = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateUID(len = 8) {
    var res = "";

    for(var i = 0; i < len; i++) {
        res += alp[Math.floor(Math.random() * alp.length)];
    }

    return res;
}

function getUserIdBySocket(socket) {
    for(var user of Object.keys(users)) {
        if(users[user].authToken == socket.authToken) {
            return user;
        }
    }
}

function hasPermission(user, permission) {
    return permission in roles[user.role].permissions;
}