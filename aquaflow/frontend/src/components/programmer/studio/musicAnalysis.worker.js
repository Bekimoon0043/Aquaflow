import { analyzeSamples } from './musicAnalysis';
self.onmessage = ({ data }) => {
  try {
    const { analysis, features } = analyzeSamples(data.samples, data.rate);
    self.postMessage({ id: data.id, analysis, features }, [features.novelty.buffer, features.bassNovelty.buffer, features.energy.buffer]);
  } catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};
