export function updateUIDigRadius(digRadius: number) {
  const digSpan = document.getElementById("dig-radius");
  if (digSpan) digSpan.textContent = ` - / + Dig Size (${digRadius}m)`;
}
