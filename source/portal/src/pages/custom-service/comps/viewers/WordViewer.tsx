import { Document, Page } from 'react-pdf';
import { useEffect, useState } from 'react';
// import { S3Client } from '@aws-sdk/client-s3';
// import ConfigContext from 'src/context/config-context';
// import { convertWordFromS3ToPdfAndReturnUrl, parseS3Uri } from 'src/utils/utils';
import useAxiosRequest from 'src/hooks/useAxiosRequest';
import { parseS3Uri } from 'src/utils/utils';

// Set up PDF.js worker
// pdfjs.GlobalWorkerOptions.workerSrc = new URL(
//   'pdfjs-dist/build/pdf.worker.min.js',
//   import.meta.url,
// ).toString();

const WordPreview = ({ fileKey }: { fileKey: string }) => {
  const [pdfUrl, setPdfUrl] = useState('');
  const [error, setError] = useState('');
  const [numPages, setNumPages] = useState<number | null>(null);
//   const config = useContext(ConfigContext);
  const fetchData = useAxiosRequest();
//   const s3Client = new S3Client({ region: config?.oidcRegion });

  useEffect(() => {
    const { bucket, key } = parseS3Uri(fileKey);
    const wordPreview = async () => {
      try {
        const wordPreviewRes = await fetchData({
          url: 'converter/word-2-pdf',
          method: 'post',
          data: {
            bucket: bucket,
            key: key,
          },
        });
        setPdfUrl(wordPreviewRes);
        setError('');
      } catch (err) {
        setError('文档加载失败，请稍后重试');
        console.error('PDF loading error:', err);
      }
    };
    wordPreview();
  }, [fileKey]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const onDocumentLoadError = (error: Error) => {
    setError('PDF 加载失败，请稍后重试');
    console.error('PDF loading error:', error);
  };

//   if (error) return <div className="text-red-500">{error}</div>;
  if (error) return <div className="text-red-500 p-4">{error}</div>;
  if (!pdfUrl) return <div className="p-4">加载中...</div>;

  return (
    <div className="pdf-viewer" style={{ border: '1px solid #ccc', padding: '20px' }}>
      <Document
        file={pdfUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={onDocumentLoadError}
        loading={<div>PDF 加载中...</div>}
      >
        {numPages && Array.from(new Array(numPages), (el, index) => (
          <Page 
            key={`page_${index + 1}`}
            pageNumber={index + 1}
            renderTextLayer={false}
            renderAnnotationLayer={false}
          />
        ))}
      </Document>
    </div>
  );
};

export default WordPreview;
