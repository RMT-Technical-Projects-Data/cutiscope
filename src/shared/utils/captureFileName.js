export const pad = (num) => num.toString().padStart(2, '0');

export const generateFileName = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());

  return `Dermscope_${year}${month}${day}_${hours}${minutes}${seconds}.jpg`;
};
