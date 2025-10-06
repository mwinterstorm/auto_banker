ARG BUILD_FROM
FROM $BUILD_FROM

# Install Node and curl (Alpine base)
RUN apk add --no-cache nodejs npm curl

WORKDIR /opt/auto_banker

# Install dependencies
COPY package.json ./
RUN npm ci --omit=dev

COPY index.js ./
COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
