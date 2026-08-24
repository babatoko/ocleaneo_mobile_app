import axios from 'axios';

// Client HTTP interne au RestProvider : rien en dehors de providers/RestProvider.js
// ne doit importer ce fichier — c'est précisément le détail d'implémentation
// que l'abstraction DataProvider existe pour cacher au reste de l'app.
export const restClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api',
});

restClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('ocleaneo_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

restClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('ocleaneo_token');
    }
    return Promise.reject(error);
  }
);
