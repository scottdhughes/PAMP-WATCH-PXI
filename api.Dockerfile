FROM node:20-alpine AS base
WORKDIR /app
COPY package.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm install
RUN npm run build --workspaces
CMD ["npm", "run", "start", "--workspace", "@pxi/api"]
