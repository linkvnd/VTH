import express from "express";
import cors from "cors";
import axios from "axios";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Proxy for Wallet API
  app.post("/api/proxy/wallet", async (req, res) => {
    try {
      console.log("Proxying wallet request for UID:", req.headers["user-id"]);
      const response = await axios.post("https://wallet.3games.io/api/wallet/user_asset", req.body, {
        headers: {
          "accept": "application/json, text/plain, */*",
          "accept-language": "vi,en;q=0.9",
          "content-type": "application/json",
          "country-code": "vn",
          "origin": "https://xworld.info",
          "referer": "https://xworld.info/",
          "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
          "user-login": "login_v2",
          "xb-language": "vi-VN",
          "user-id": req.headers["user-id"] as string,
          "user-secret-key": req.headers["user-secret-key"] as string,
        },
        timeout: 10000,
      });
      
      if (!response.data) {
        return res.status(200).json({ data: {} });
      }
      res.json(response.data);
    } catch (error: any) {
      console.error("Wallet Proxy Error:", error.message);
      const status = error.response?.status || 500;
      const data = error.response?.data || { error: error.message };
      res.status(status).json(typeof data === 'string' ? { error: data } : data);
    }
  });

  // Proxy for Bet API
  app.post("/api/proxy/bet", async (req, res) => {
    try {
      console.log("Proxying bet request for UID:", req.headers["user-id"]);
      const response = await axios.post("https://api.escapemaster.net/escape_game/bet", req.body, {
        headers: {
          "accept": "application/json, text/plain, */*",
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0",
          "user-id": req.headers["user-id"] as string,
          "user-secret-key": req.headers["user-secret-key"] as string,
        },
        timeout: 10000,
      });
      
      if (!response.data) {
        return res.status(200).json({ msg: "ok", code: 0 });
      }
      res.json(response.data);
    } catch (error: any) {
      console.error("Bet Proxy Error:", error.message);
      const status = error.response?.status || 500;
      const data = error.response?.data || { error: error.message };
      res.status(status).json(typeof data === 'string' ? { error: data } : data);
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
