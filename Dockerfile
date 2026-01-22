FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY src ./src
COPY tsconfig.json ./
COPY .env* ./

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 1112

# Start application
CMD ["npm", "start:ts"]
