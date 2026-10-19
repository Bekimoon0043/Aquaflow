import { analyzeStem } from './stemAnalysis';
self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, analysis: analyzeStem(data.samples, data.rate, data.role) }); }
  catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};
