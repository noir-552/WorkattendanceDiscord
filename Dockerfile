FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV DB_PATH=/app/data/worklog.db
VOLUME ["/app/data"]
CMD ["node", "index.js"]
