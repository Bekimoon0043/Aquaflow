import { splitSong } from './stemSplit';
self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, stems: splitSong(data.samples, data.rate, (p) => self.postMessage({ id: data.id, progress: p })) }); }
  catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};
