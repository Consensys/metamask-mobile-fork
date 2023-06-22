import { Action } from 'redux';
import { take, fork, cancel } from 'redux-saga/effects';
import { StackActions } from '@react-navigation/native';
import {
  AUTH_ERROR,
  AUTH_SUCCESS,
  BIOMETRICS_SUCCESS,
  IN_APP,
  LOCKED_APP,
  OUT_APP,
  authSuccess,
  lockApp,
} from '../../actions/user';
import Routes from '../../constants/navigation/Routes';
import { biometricsListener, authStateMachine } from './';

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
jest.mock('../../core/NavigationService', () => ({
  navigation: {
    navigate: (params: any) => mockNavigate(params),
    dispatch: (params: Action) => mockDispatch(params),
  },
}));

describe('biometricsListener', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockDispatch.mockClear();
  });

  it('should navigate to LockScreen when app is locked', async () => {
    const generator = biometricsListener();
    expect(generator.next().value).toEqual(take(LOCKED_APP));
    expect(generator.next().value).toEqual(take(BIOMETRICS_SUCCESS));
    expect(mockNavigate).toBeCalledWith('LockScreen');
  });

  it('should navigate to Wallet when authenticating without interruptions via biometrics', async () => {
    const generator = biometricsListener();
    // Lock app
    generator.next();
    // Biometrics success
    generator.next();
    // Take next step
    expect(generator.next().value).toEqual(
      take([AUTH_SUCCESS, LOCKED_APP, AUTH_ERROR]),
    );
    // Auth success
    generator.next(authSuccess() as Action);
    expect(mockDispatch).toBeCalledWith(
      StackActions.replace(Routes.ONBOARDING.HOME_NAV, {
        screen: Routes.WALLET_VIEW,
      }),
    );
  });

  it('should navigate to LockScreen when backgrounding in the middle of authenticating via biometrics', async () => {
    const generator = biometricsListener();
    // Lock app
    generator.next();
    // Biometrics success
    generator.next();
    // Take next step
    expect(generator.next().value).toEqual(
      take([AUTH_SUCCESS, LOCKED_APP, AUTH_ERROR]),
    );
    // Backgrounded app
    generator.next(lockApp() as Action);
    expect(mockDispatch).toBeCalledWith(StackActions.replace('LockScreen'));
  });
});

describe('authStateMachine', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockDispatch.mockClear();
  });

  it('should fork biometricsListener when logged in', async () => {
    const generator = authStateMachine();
    expect(generator.next().value).toEqual(take(IN_APP));
    expect(generator.next().value).toEqual(fork(biometricsListener));
  });

  it('should cancel biometricsListener when logged out', async () => {
    const generator = authStateMachine();
    // Logged in
    generator.next();
    // Fork biometrics listener
    generator.next();
    expect(generator.next().value).toEqual(take(OUT_APP));
    expect(generator.next().value).toEqual(cancel());
  });
});
