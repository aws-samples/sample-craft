import axios from 'axios';
import { useContext } from 'react';
import ConfigContext from 'src/context/config-context';
import { alertMsg, genHeaderOidcInfo, getCredentials, isTokenExpired } from 'src/utils/utils';


const useAxiosWorkspaceRequest = () => {
  const config = useContext(ConfigContext);
  
  const token = getCredentials();
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
    if(isTokenExpired()){
      window.location.href = '/login'
      return null
    }
    try {
      const response = await axios({
        method: method,
        url: `${config?.workspaceApiUrl}${url}`,
        data: data,
        params: params,
        headers: {
          ...headers,
          'Authorization': `Bearer ${token.access_token || token.idToken}`,
          'Oidc-Info': genHeaderOidcInfo(config)
        },
      });
      return response.data;
    } catch (error) {
      if (error instanceof Error) {
        alertMsg(error.message);
      }
      throw error;
    }
  };
  return sendRequest;
};

export default useAxiosWorkspaceRequest;
