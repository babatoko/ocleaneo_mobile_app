const CATEGORY_ICONS = {
  Sol: 'ti-spray',
  Vitres: 'ti-droplet',
  Sanitaires: 'ti-toilet-paper',
  Consommables: 'ti-package',
};

export function iconForProduct(product) {
  return CATEGORY_ICONS[product.category] || 'ti-flask';
}
