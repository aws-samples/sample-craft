import axios from 'axios';
import { useContext } from 'react';
import ConfigContext from 'src/context/config-context';

const useAxiosAuthRequest = () => {
  const config = useContext(ConfigContext);
  const sendRequest = async ({
    url = '',
    method = 'get',
    data = null,
    headers = {},
    params = {},
  }: {
    url: string;
    method: 'get' | 'post' | 'put' | 'delete';
    data?: any;
    headers?: any;
    params?: any;
  }) => {
    try {
      const response = await axios({
        method: method,
        url: `${config?.apiUrl}${url}`,
        data: data,
        params: params,
        headers: {
          ...headers
        },
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  };
  return sendRequest;
};

export default useAxiosAuthRequest;
