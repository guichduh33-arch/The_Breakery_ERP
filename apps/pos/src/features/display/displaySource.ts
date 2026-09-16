const SOURCE_KEY = 'breakery.display-source.v1';
export function getDisplaySourceId(): string {
  const saved = sessionStorage.getItem(SOURCE_KEY);
  if (saved) return saved;
  const id = crypto.randomUUID();
  sessionStorage.setItem(SOURCE_KEY, id);
  return id;
}
export function displayChannel(source = getDisplaySourceId()): string { return `breakery-cart:${source}`; }
export function openCustomerDisplay(): void {
  window.open(`/display?source=${encodeURIComponent(getDisplaySourceId())}`, 'breakery-customer-display', 'popup,width=1280,height=800');
}
