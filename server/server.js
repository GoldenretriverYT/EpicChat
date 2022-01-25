(async () => {
    const express = require('express');
    const http = require('http');
    const fs = require("fs");
    const bcrypt = require("bcrypt");
    const { Server } = require("socket.io");

    var config = require("./chatConfig.json");

    /* Setting up web server & socket.io */
    const app = express();
    const server = http.createServer(app);
    const io = new Server(server, {
        "pingTimeout": 120*1000,
        "maxHttpBufferSize": (1024*1024) + (config.maxFileSizeKB*1024)
    });

    const mysql = require('mysql2/promise');

    const connection = await mysql.createConnection({
        host: config.data.host,
        user: config.data.user,
        password: config.data.pass
    }).catch((err) => {
        exitErr("Failed to connect to database: " + err);
    });

    await connection.query("CREATE DATABASE IF NOT EXISTS epicchat;").catch((err) => {
        exitErr("Failed to create database: " + err);
    });

    await connection.query("USE epicchat;").catch((err) => {
        exitErr("Failed to select database: " + err);
    });

    await connection.query('CREATE TABLE IF NOT EXISTS `messages` (`id` int NOT NULL AUTO_INCREMENT, `authorId` int DEFAULT NULL, `content` mediumtext, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci').catch((err) => {
        exitErr("Failed to create table messages: " + err);
    });

    await connection.query('CREATE TABLE IF NOT EXISTS `users` ( `userId` int NOT NULL AUTO_INCREMENT, `username` text, `passwordHash` text, `assignedRole` int DEFAULT NULL, PRIMARY KEY (`userId`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci').catch((err) => {
        exitErr("Failed to create table users: " + err);
    });

    await connection.query('CREATE TABLE IF NOT EXISTS `roles` (`id` int NOT NULL AUTO_INCREMENT,`name` text,`color` tinytext,`permissionWrite` tinyint DEFAULT NULL,`permissionDeleteOther` tinyint DEFAULT NULL,`permissionBan` tinyint DEFAULT NULL,PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci').catch((err) => {
        exitErr("Failed to create table roles: " + err);
    });

    var [rows] = await connection.query("SELECT * FROM roles WHERE name='everyone'").catch((err) => {
        exitErr("Failed to check if default role exists: " + err);
    });

    if(rows.length < 1) {
        console.log("No default role, creating it.");
        await connection.query("INSERT INTO roles (name, color, permissionWrite, permissionDeleteOther, permissionBan, permissionManageRoles) VALUES ('everyone', '#000000', 1, 0, 0, 0)").catch((err) => {
            exitErr("Failed to create default role: " + err);
        });
    }

    app.use('/', express.static('public'));

    io.on('connection', (socket) => {
        socket.uniqueId = generateUID();
        socket.authToken = "not_logged_in";

        socket.on("update auth token", (data, answer) => {
            socket.authToken = data;
            answer({success: 1, data: {}});
        });

        socket.on("verify auth token", (data, answer) => {
            if(getUserBySocket(socket) == null) {
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

            if(data.password.length < 8) {
                answer({success: 0, data: "Your password is too short. At least 8 characters."});
                return;
            }

            bcrypt.hash(data.password).then((hash) => {
                users[generateUID(16)] = ({
                    "username": data.username,
                    "passwordHash": hash,
                    "role": "0",
                    "authToken": "NOT_LOGGED_IN",
                });

                answer({success: 1, data: "You can now log in."});
            });
        });

        socket.on("login account", (data, answer) => {
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

            var user = getUserBy("username", data.username);

            if(user == null) {
                answer(fail("Username or password invalid."));
                return;
            }

            bcrypt.compare(data.password, users[user].passwordHash).then((isValid) => {
                if(isValid) {
                    users[user].authToken = generateUID(16);
                    socket.authToken = users[user].authToken;

                    answer(success(users[user].authToken)); // Also send to user to save auth token for later resend
                }else {
                    answer(fail("Username or password invalid."));
                }
            });
        });
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

    function getUserBySocket(socket) {
        for(var user of Object.keys(users)) {
            if(users[user].authToken == socket.authToken) {
                return user;
            }
        }
    }

    function getUserBy(field, value) {
        for(var user of Object.keys(users)) {
            if(field == "id" && user == value) return user;

            if(field in user && user[field] == value) return user;
        }
    }

    function hasPermission(user, permission) {
        return permission in roles[user.role].permissions;
    }

    function fail(data) {
        return {success: 0, data: data};
    }

    function success(data) {
        return {success: 1, data: data};
    }

    function exitErr(err) {
        console.error(err);
        process.exit(1);
    }
})();