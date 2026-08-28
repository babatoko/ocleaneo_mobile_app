FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Les trois variables que providers/index.ts lit pour choisir et adresser un
# backend (voir .env.example) — Vite les fige à la valeur du build, donc
# toutes doivent être des ARG ici, pas seulement celle du provider par
# défaut. En manquer une revient à figer silencieusement le repli codé en
# dur de providers/RestProvider.ts ou OdooProvider.ts, quel que soit ce que
# l'appelant de `docker build` avait l'intention de configurer.
ARG VITE_DATA_PROVIDER=rest
ARG VITE_API_URL=http://localhost:3000/api
ARG VITE_ODOO_API_URL=http://localhost:8069/api/mobile
ENV VITE_DATA_PROVIDER=$VITE_DATA_PROVIDER
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_ODOO_API_URL=$VITE_ODOO_API_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
