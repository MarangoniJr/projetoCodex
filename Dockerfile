FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --chown=node:node server ./server
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node package.json *.html *.js *.css *.svg *.webmanifest ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server/vps.js"]
