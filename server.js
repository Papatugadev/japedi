const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const root = __dirname;
const clientDir = path.join(root, "client");
const adminDir = path.join(root, "admin");

// arquivos estáticos do admin
app.use("/admin", express.static(adminDir));

// rota do admin
app.get("/admin", (req, res) => {
  res.sendFile(path.join(adminDir, "index.html"));
});

// se houver navegação interna no admin
app.get("/admin/*", (req, res) => {
  res.sendFile(path.join(adminDir, "index.html"));
});

// arquivos estáticos do client
app.use(express.static(clientDir));

// rota principal do client
app.get("/", (req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

// fallback do client
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});