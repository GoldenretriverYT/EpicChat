(async () => {
    const express = require('express');
    const http = require('http');
    const fs = require("fs");
    const bcrypt = require("bcrypt");
    const { Server } = require("socket.io");

    var config = require("./chatConfig.json");
    var sockets = {};

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

    await connection.query('CREATE TABLE IF NOT EXISTS `users` ( `userId` int NOT NULL AUTO_INCREMENT, `username` text, `passwordHash` text, `assignedRole` int DEFAULT NULL, `authToken` text, PRIMARY KEY (`userId`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci').catch((err) => {
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
        socket.authToken = "not_logged_in";
        sockets[socket.id] = socket;

        socket.on("update auth token", (data, answer) => {
            socket.authToken = data;
            answer({success: 1, data: {}});
        });

        socket.on("create account", async (data, answer) => {
            if(!("username" in data) || !("password" in data)) {
                answer({success: 0, data: "No username/password provided"});
                return;
            }

            if(data.username.length < 3 || data.username.length > 20) {
                answer({success: 0, data: "Username too short or too long. (3-20 chars)"});
                return;
            }

            if((data.username.match(/([^A-Za-z0-9_])/g) || []).length > 0) {
                answer({success: 0, data: "Username includes invalid characters (allowed: a-zA-Z0-9_)"});
                return;
            }

            if(data.password.length < 8) {
                answer({success: 0, data: "Your password is too short. At least 8 characters."});
                return;
            }

            bcrypt.hash(data.password, 10).then(async (hash) => {
                var [rows] = await connection.query("INSERT INTO users (username, passwordHash, assignedRole, authToken) VALUES (?, ?, 1, ?)", [data.username, hash, generateUID(32)]);

                answer({success: 1, data: "You can now log in."});
            });
        });

        socket.on("login account", async (data, answer) => {
            if(!("username" in data) || !("password" in data)) {
                answer({success: 0, data: "No username/password provided"});
                return;
            }

            if(data.username.length < 3 || data.username.length > 20) {
                answer({success: 0, data: "Username too short or too long. (3-20 chars)"});
                return;
            }

            if((data.username.match(/([^A-Za-z0-9_])/g) || []).length > 0) {
                answer({success: 0, data: "Username includes invalid characters (allowed: a-zA-Z0-9_)"});
                return;
            }

            var [rows] = await connection.query("SELECT * FROM users WHERE username=?", [data.username]);

            if(rows.length < 1) {
                answer(fail("Username or password invalid."));
                return;
            }

            bcrypt.compare(data.password, rows[0].passwordHash).then(async (isValid) => {
                if(isValid) {
                    var authToken = generateUID(32);

                    var [results] = await connection.query("UPDATE users SET authToken=? WHERE userId=?", [authToken, rows[0].userId]);
                    socket.authToken = authToken;
                    socket.join("actualChat");
                    answer(success(authToken)); // Also send to user to save auth token for later resend
                }else {
                    answer(fail("Username or password invalid."));
                }
            });
        });

        socket.on("send message", async (data, answer) => {
            var user = await getUserBySocket(socket);

            if(user == null) {
                answer(fail("You are not logged in."));
                return;
            }

            if(!("content" in data)) {
                answer(fail("Invalid/no content provided"));
                return;
            }

            if(data.content.trim().length > 2000 || data.content.trim().length < 1) {
                answer(fail("Your message can be 2000 characters at most and must be at least 1 character long."));
                return;
            }

            var [rows] = await connection.query("INSERT INTO messages (authorId, content) VALUES (?, ?)", [user.id, data.content.replace(/<\/?[^>]+(>|$)/g, "").trim()]).catch((err) => {
                answer(fail("An internal server error occurred. Oops."));
                return;
            });

            io.to("actualChat").emit("server send message", {
                authorId: user.userId,
                content: data.content
            });
        });

        socket.on("get user", async (data, answer) => {
            var user = await getUserBySocket(socket);

            if(user == null) {
                answer(fail("You are not logged in."));
                return;
            }

            if(!("userId" in data)) {
                answer(fail("Invalid/no userid provided"));
                return;
            }

            var [rows] = await connection.query("SELECT username,assignedRole FROM users WHERE userId=?", [data.userId]).catch((err) => {
                answer(fail("An internal server error occurred. Oops."));
                return;
            });

            answer(success({userData: rows[0]}));
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

    async function getUserBySocket(socket) {
        console.log(socket.authToken);
        var [rows] = await connection.query("SELECT * FROM users WHERE authToken=?", [socket.authToken]);

        if(rows.length == 0) return null;
        return rows[0];
    }

    async function hasPermission(user, permission) {
        var [rows] = await connection.query("SELECT * FROM roles WHERE id=?", [user.assignedRole]);
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