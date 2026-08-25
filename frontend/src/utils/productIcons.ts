import { waterOutline, sparklesOutline, homeOutline, cubeOutline, flaskOutline } from 'ionicons/icons';
import type { Product } from '../types/models';

const CATEGORY_ICONS: Record<string, string> = {
  Sol: waterOutline,
  Vitres: sparklesOutline,
  Sanitaires: homeOutline,
  Consommables: cubeOutline,
};

export function iconForProduct(product: Pick<Product, 'category'>): string {
  return (product.category && CATEGORY_ICONS[product.category]) || flaskOutline;
}
