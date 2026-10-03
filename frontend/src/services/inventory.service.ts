import { Inventory } from "@/types";
import { apiBaseUrl } from "@/lib/runtimeEnv";
import { api } from "./api";

export async function getInventories(): Promise<Inventory[]> {
  return api<Inventory[]>("/api/inventory");
}

export async function updateInventories(inventories: Inventory[]): Promise<Inventory[]> {
  return api<Inventory[]>("/api/inventory/bulk", {
    method: "PUT",
    body: JSON.stringify(inventories),
  });
}

export async function createProduct(payload: {
  name: string;
  sku: string;
  price: number;
  quantity: number;
  description?: string;
  imageUrl?: string | null;
}): Promise<Inventory> {
  return api<Inventory>("/api/inventory", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateProduct(
  id: string,
  payload: Partial<{
    name: string;
    sku: string;
    price: number;
    quantity: number;
    description: string;
    imageUrl: string | null;
  }>
): Promise<Inventory> {
  return api<Inventory>(`/api/inventory/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteProduct(id: string): Promise<void> {
  await api(`/api/inventory/${id}`, { method: "DELETE" });
}

export async function adjustQuantity(id: string, delta: number): Promise<Inventory> {
  return api<Inventory>(`/api/inventory/${id}/adjust`, {
    method: "POST",
    body: JSON.stringify({ delta }),
  });
}

export async function uploadProductImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("image", file);
  const response = await fetch(`${apiBaseUrl()}/api/uploads/image`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "Image upload failed");
  }
  const json = (await response.json()) as { imageUrl: string };
  return json.imageUrl;
}

export function resolveImageUrl(url?: string | null) {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) return url;
  return `${apiBaseUrl()}${url}`;
}
