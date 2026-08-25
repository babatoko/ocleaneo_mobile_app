import type { Product } from '../types/models';

const CATEGORY_ICONS: Record<string, string> = {
  Sol: 'ti-spray',
  Vitres: 'ti-droplet',
  Sanitaires: 'ti-toilet-paper',
  Consommables: 'ti-package',
};

export function iconForProduct(product: Pick<Product, 'category'>): string {
  return (product.category && CATEGORY_ICONS[product.category]) || 'ti-flask';
}
