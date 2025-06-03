import React, { Suspense } from 'react';
import AppRouter from './Router';
import AutoLogout from './secure/auto-logout';
import { OIDC_PREFIX, ROUTES } from './utils/const';
import ConfigProvider from './context/config-provider';
import { hasPrefixKeyInLocalStorage, isTokenExpired } from './utils/utils';
import { Provider } from 'react-redux';
import { store } from './app/store.ts';
import './index.scss';

const AppBody = () => {
  return (
    <Suspense fallback={null}>
        <ConfigProvider>
        <Provider store={store}>
          <AppRouter/>
          </Provider>
        </ConfigProvider>
    </Suspense>
  )
};

const App: React.FC = () => {
  const hasToken = hasPrefixKeyInLocalStorage(OIDC_PREFIX)
  if(window.location.pathname !== ROUTES.Login){
  if (hasToken){
    if(isTokenExpired()){
      window.location.href=ROUTES.Login;
      return null;
    }
  } else {
    if(![ROUTES.Login, ROUTES.ChangePWD, ROUTES.FindPWD, ROUTES.Register].includes(window.location.pathname)){
      window.location.href=ROUTES.Login;
      return null;
    }
  }
  }
  return (
    <>
      <AutoLogout timeout={24 * 60 * 60 * 1000} />
      <AppBody />
    </>
  );
};

export default App;