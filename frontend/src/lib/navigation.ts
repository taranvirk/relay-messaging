export function replaceWithLogin(): void {
  // Discard the signed-in React tree, socket, and any stale query observers.
  window.location.replace('/login');
}
