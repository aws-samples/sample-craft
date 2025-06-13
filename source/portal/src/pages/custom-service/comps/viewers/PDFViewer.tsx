import { Document, Page } from 'react-pdf';
import { useEffect, useState } from 'react';
import useAxiosRequest from 'src/hooks/useAxiosRequest';
import { parseS3Uri } from 'src/utils/utils';
import { pdfjs } from 'react-pdf';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const PDFPreview = ({ fileKey }: { fileKey: string }) => {
  const [pdfUrl, setPdfUrl] = useState('');
  const [error, setError] = useState('');
  const [numPages, setNumPages] = useState<number | null>(null);

  const fetchData = useAxiosRequest();

  useEffect(() => {
    const { bucket, key } = parseS3Uri(fileKey);
    const PDFPreview = async () => {
      try {
        const PDFPreviewRes = await fetchData({
          url: 'viewer/pdf',
          method: 'post',
          data: {
            bucket: bucket,
            key: key,
          },
        });
        setPdfUrl(PDFPreviewRes);
        setError('');
      } catch (err) {
        setError('File loading error');
        console.error('File loading error:', err);
      }
    };
    
    PDFPreview();
  }, [fileKey]);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const onDocumentLoadError = (error: Error) => {
    setError('File loading error');
    console.error('File loading error:', error);
  };

  if (error) return <div className="text-red-500 p-4">{error}</div>;
  if (!pdfUrl) return <div className="p-4">加载中...</div>;

  return (
    <div className="pdf-viewer" style={{ border: '1px solid #ccc', padding: '20px' }}>
      <Document
        file={pdfUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={onDocumentLoadError}
        loading={<div>文件加载中...</div>}
      >
        {numPages && Array.from(new Array(numPages), (__, index) => (
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

export default PDFPreview;
