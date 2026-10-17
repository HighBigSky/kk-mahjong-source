FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5173
ENV HOST=0.0.0.0
COPY package.json ./
COPY server.js engine.js app.js index.html ./
COPY styles.css table-depth.css tiles-depth.css seats-layout.css laizi.css rooms.css wall-layout.css landscape.css ./
COPY src ./src
COPY assets ./assets
EXPOSE 5173
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||5173)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
