// Life and learning keep their original records, but have their own boards.
// Legacy appointments without a category remain visible in the work agenda.
export function isWorkAgenda(item) {
  return !['生活', '学习'].includes(item.category);
}
