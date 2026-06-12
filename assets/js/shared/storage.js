// Safe localStorage access shared by the reader and the editor — never throws
// (private mode, quota, disabled storage, …).
export function get(k, d) {
  try {
    return localStorage.getItem(k) || d;
  } catch (e) {
    return d;
  }
}
export function set(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch (e) {}
}
export function del(k) {
  try {
    localStorage.removeItem(k);
  } catch (e) {}
}
