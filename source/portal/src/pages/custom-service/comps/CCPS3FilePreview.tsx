import React, { useEffect, useState } from 'react';
import { Document, Page } from 'react-pdf';
import * as XLSX from 'xlsx';

interface Props {
  presignedUrl: string;
  fileName: string; // 带扩展名
}

const CCPS3FilePreview: React.FC<Props> = ({ presignedUrl, fileName }) => {
  const [blobUrl, setBlobUrl] = useState('');
  const [textContent, setTextContent] = useState('');
  const [excelData, setExcelData] = useState<any[]>([]);
  const [error, setError] = useState('');

  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  useEffect(() => {
    const loadFile = async () => {
      try {
        const res = await fetch(presignedUrl);
        if (!res.ok) throw new Error('无法加载文件');

        if (['txt', 'md', 'json'].includes(ext)) {
          const text = await res.text();
          setTextContent(text);
        } else if (['xlsx', 'xls'].includes(ext)) {
          const blob = await res.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const wb = XLSX.read(arrayBuffer, { type: 'array' });
          const sheet = wb.SheetNames[0];
          const data = XLSX.utils.sheet_to_json(wb.Sheets[sheet]);
          setExcelData(data);
        } else {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          setBlobUrl(url);
        }
      } catch (err: any) {
        setError(err.message || '文件加载失败');
      }
    };

    loadFile();
  }, [presignedUrl, ext]);

  if (error) return <p className="text-red-500">{error}</p>;

  // 渲染逻辑
  if (['txt', 'md', 'json'].includes(ext)) {
    return (
      <div className="bg-gray-100 p-4 rounded whitespace-pre-wrap">
        <h3 className="font-bold mb-2">文本内容预览：</h3>
        <pre>{textContent}</pre>
      </div>
    );
  }

  if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) {
    return <img src={blobUrl} alt="预览图像" className="max-w-full border" />;
  }

  if (ext === 'pdf') {
    return (
      <div className="border">
        <Document file={blobUrl}>
          <Page pageNumber={1} />
        </Document>
      </div>
    );
  }

  if (['doc', 'docx'].includes(ext)) {
    const officeViewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(presignedUrl)}`;
    return (
      <iframe
        src={officeViewerUrl}
        title="Word Viewer"
        width="100%"
        height="600px"
        className="border"
      />
    );
  }

  if (['xlsx', 'xls'].includes(ext)) {
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full table-auto border border-gray-300">
          <thead>
            <tr>
              {Object.keys(excelData[0] || {}).map((key) => (
                <th key={key} className="border px-2 py-1 bg-gray-200">{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {excelData.map((row, i) => (
              <tr key={i}>
                {Object.values(row).map((val, j) => (
                  <td key={j} className="border px-2 py-1">{val as string}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return <p>不支持的文件类型：{ext}</p>;
};

export default CCPS3FilePreview;
