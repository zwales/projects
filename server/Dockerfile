FROM node:20-slim
WORKDIR /app

# better-sqlite3 compiles a native addon; these are needed on slim images
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
