import React, { useState, useEffect, useCallback } from 'react';

import { Alert, InteractionManager } from 'react-native';
import PropTypes from 'prop-types';
import { connect, useSelector } from 'react-redux';
import { ethers } from 'ethers';
import abi from 'human-standard-token-abi';

import NotificationManager from '../../../core/NotificationManager';
import Engine from '../../../core/Engine';
import { strings } from '../../../../locales/i18n';
import { hexToBN, fromWei, isZeroValue } from '../../../util/number';
import {
  setEtherTransaction,
  setTransactionObject,
} from '../../../actions/transaction';
import WalletConnect from '../../../core/WalletConnect/WalletConnect';
import {
  getMethodData,
  TOKEN_METHOD_TRANSFER,
  APPROVE_FUNCTION_SIGNATURE,
  getTokenValueParam,
  getTokenAddressParam,
  calcTokenAmount,
  getTokenValueParamAsHex,
  isSwapTransaction,
} from '../../../util/transactions';
import { BN } from 'ethereumjs-util';
import Logger from '../../../util/Logger';
import TransactionTypes from '../../../core/TransactionTypes';
import { swapsUtils } from '@metamask/swaps-controller';
import { query } from '@metamask/controller-utils';
import Analytics from '../../../core/Analytics/Analytics';
import BigNumber from 'bignumber.js';
import { getTokenList } from '../../../reducers/tokens';
import { toLowerCaseEquals } from '../../../util/general';
import { ApprovalTypes } from '../../../core/RPCMethods/RPCMethodMiddleware';
import { KEYSTONE_TX_CANCELED } from '../../../constants/error';
import { MetaMetricsEvents } from '../../../core/Analytics';
import AnalyticsV2 from '../../../util/analyticsV2';

import withQRHardwareAwareness from '../../UI/QRHardware/withQRHardwareAwareness';
import QRSigningModal from '../../UI/QRHardware/QRSigningModal';
import { networkSwitched } from '../../../actions/onboardNetwork';
import {
  selectChainId,
  selectProviderType,
} from '../../../selectors/networkController';
import { createAccountConnectNavDetails } from '../../Views/AccountConnect';
import WatchAssetApproval from '../../Approvals/WatchAssetApproval';
import SignatureApproval from '../../Approvals/SignatureApproval';
import AddChainApproval from '../../Approvals/AddChainApproval';
import SwitchChainApproval from '../../Approvals/SwitchChainApproval';
import WalletConnectApproval from '../../Approvals/WalletConnectApproval';
import ConnectApproval from '../../Approvals/ConnectApproval';
import TransactionApproval, {
  TransactionModalType,
} from '../../Approvals/TransactionApproval';

const hstInterface = new ethers.utils.Interface(abi);

const RootRPCMethodsUI = (props) => {
  const [showPendingApproval, setShowPendingApproval] = useState(false);
  const [transactionModalType, setTransactionModalType] = useState(undefined);
  const tokenList = useSelector(getTokenList);
  const setTransactionObject = props.setTransactionObject;
  const setEtherTransaction = props.setEtherTransaction;

  const showPendingApprovalModal = ({ type, origin }) => {
    InteractionManager.runAfterInteractions(() => {
      setShowPendingApproval({ type, origin });
    });
  };

  const initializeWalletConnect = () => {
    WalletConnect.init();
  };

  const trackSwaps = useCallback(
    async (event, transactionMeta) => {
      try {
        const { TransactionController } = Engine.context;
        const newSwapsTransactions = props.swapsTransactions;
        const swapTransaction = newSwapsTransactions[transactionMeta.id];
        const {
          sentAt,
          gasEstimate,
          ethAccountBalance,
          approvalTransactionMetaId,
        } = swapTransaction.paramsForAnalytics;

        const approvalTransaction =
          TransactionController.state.transactions.find(
            ({ id }) => id === approvalTransactionMetaId,
          );
        const ethBalance = await query(
          TransactionController.ethQuery,
          'getBalance',
          [props.selectedAddress],
        );
        const receipt = await query(
          TransactionController.ethQuery,
          'getTransactionReceipt',
          [transactionMeta.transactionHash],
        );

        const currentBlock = await query(
          TransactionController.ethQuery,
          'getBlockByHash',
          [receipt.blockHash, false],
        );
        let approvalReceipt;
        if (approvalTransaction?.transactionHash) {
          approvalReceipt = await query(
            TransactionController.ethQuery,
            'getTransactionReceipt',
            [approvalTransaction.transactionHash],
          );
        }
        const tokensReceived = swapsUtils.getSwapsTokensReceived(
          receipt,
          approvalReceipt,
          transactionMeta?.transaction,
          approvalTransaction?.transaction,
          swapTransaction.destinationToken,
          ethAccountBalance,
          ethBalance,
        );

        newSwapsTransactions[transactionMeta.id].gasUsed = receipt.gasUsed;
        if (tokensReceived) {
          newSwapsTransactions[transactionMeta.id].receivedDestinationAmount =
            new BigNumber(tokensReceived, 16).toString(10);
        }
        TransactionController.update({
          swapsTransactions: newSwapsTransactions,
        });

        const timeToMine = currentBlock.timestamp - sentAt;
        const estimatedVsUsedGasRatio = `${new BigNumber(receipt.gasUsed)
          .div(gasEstimate)
          .times(100)
          .toFixed(2)}%`;
        const quoteVsExecutionRatio = `${swapsUtils
          .calcTokenAmount(
            tokensReceived || '0x0',
            swapTransaction.destinationTokenDecimals,
          )
          .div(swapTransaction.destinationAmount)
          .times(100)
          .toFixed(2)}%`;
        const tokenToAmountReceived = swapsUtils.calcTokenAmount(
          tokensReceived,
          swapTransaction.destinationToken.decimals,
        );
        const analyticsParams = { ...swapTransaction.analytics };
        delete newSwapsTransactions[transactionMeta.id].analytics;
        delete newSwapsTransactions[transactionMeta.id].paramsForAnalytics;

        InteractionManager.runAfterInteractions(() => {
          const parameters = {
            ...analyticsParams,
            time_to_mine: timeToMine,
            estimated_vs_used_gasRatio: estimatedVsUsedGasRatio,
            quote_vs_executionRatio: quoteVsExecutionRatio,
            token_to_amount_received: tokenToAmountReceived.toString(),
          };
          Analytics.trackEventWithParameters(event, {});
          Analytics.trackEventWithParameters(event, parameters, true);
        });
      } catch (e) {
        Logger.error(e, MetaMetricsEvents.SWAP_TRACKING_FAILED);
        InteractionManager.runAfterInteractions(() => {
          Analytics.trackEvent(MetaMetricsEvents.SWAP_TRACKING_FAILED, {
            error: e,
          });
        });
      }
    },
    [props.selectedAddress, props.swapsTransactions],
  );

  const autoSign = useCallback(
    async (transactionMeta) => {
      const { TransactionController, KeyringController } = Engine.context;
      try {
        TransactionController.hub.once(
          `${transactionMeta.id}:finished`,
          (transactionMeta) => {
            if (transactionMeta.status === 'submitted') {
              NotificationManager.watchSubmittedTransaction({
                ...transactionMeta,
                assetType: transactionMeta.transaction.assetType,
              });
            } else {
              if (props.swapsTransactions[transactionMeta.id]?.analytics) {
                trackSwaps(MetaMetricsEvents.SWAP_FAILED, transactionMeta);
              }
              throw transactionMeta.error;
            }
          },
        );
        TransactionController.hub.once(
          `${transactionMeta.id}:confirmed`,
          (transactionMeta) => {
            if (props.swapsTransactions[transactionMeta.id]?.analytics) {
              trackSwaps(MetaMetricsEvents.SWAP_COMPLETED, transactionMeta);
            }
          },
        );
        await KeyringController.resetQRKeyringState();
        await TransactionController.approveTransaction(transactionMeta.id);
      } catch (error) {
        if (!error?.message.startsWith(KEYSTONE_TX_CANCELED)) {
          Alert.alert(
            strings('transactions.transaction_error'),
            error && error.message,
            [{ text: strings('navigation.ok') }],
          );
          Logger.error(error, 'error while trying to send transaction (Main)');
        } else {
          AnalyticsV2.trackEvent(
            MetaMetricsEvents.QR_HARDWARE_TRANSACTION_CANCELED,
          );
        }
      }
    },
    [props.swapsTransactions, trackSwaps],
  );

  const onUnapprovedTransaction = useCallback(
    async (transactionMeta) => {
      if (transactionMeta.origin === TransactionTypes.MMM) return;

      const to = transactionMeta.transaction.to?.toLowerCase();
      const { data } = transactionMeta.transaction;

      if (isSwapTransaction(data, transactionMeta.origin, to, props.chainId)) {
        autoSign(transactionMeta);
      } else {
        const {
          transaction: { value, gas, gasPrice, data },
        } = transactionMeta;
        const { AssetsContractController } = Engine.context;
        transactionMeta.transaction.gas = hexToBN(gas);
        transactionMeta.transaction.gasPrice = gasPrice && hexToBN(gasPrice);

        if (
          (value === '0x0' || !value) &&
          data &&
          data !== '0x' &&
          to &&
          (await getMethodData(data)).name === TOKEN_METHOD_TRANSFER
        ) {
          let asset = props.tokens.find(({ address }) =>
            toLowerCaseEquals(address, to),
          );
          if (!asset) {
            // try to lookup contract by lowercased address `to`
            asset = tokenList[to];

            if (!asset) {
              try {
                asset = {};
                asset.decimals =
                  await AssetsContractController.getERC20TokenDecimals(to);
                asset.symbol =
                  await AssetsContractController.getERC721AssetSymbol(to);
                // adding `to` here as well
                asset.address = to;
              } catch (e) {
                // This could fail when requesting a transfer in other network
                // adding `to` here as well
                asset = { symbol: 'ERC20', decimals: new BN(0), address: to };
              }
            }
          }

          const tokenData = hstInterface.parseTransaction({ data });
          const tokenValue = getTokenValueParam(tokenData);
          const toAddress = getTokenAddressParam(tokenData);
          const tokenAmount =
            tokenData && calcTokenAmount(tokenValue, asset.decimals).toFixed();

          transactionMeta.transaction.value = hexToBN(
            getTokenValueParamAsHex(tokenData),
          );
          transactionMeta.transaction.readableValue = tokenAmount;
          transactionMeta.transaction.to = toAddress;

          setTransactionObject({
            type: 'INDIVIDUAL_TOKEN_TRANSACTION',
            selectedAsset: asset,
            id: transactionMeta.id,
            origin: transactionMeta.origin,
            ...transactionMeta.transaction,
          });
        } else {
          transactionMeta.transaction.value = hexToBN(value);
          transactionMeta.transaction.readableValue = fromWei(
            transactionMeta.transaction.value,
          );

          setEtherTransaction({
            id: transactionMeta.id,
            origin: transactionMeta.origin,
            ...transactionMeta.transaction,
          });
        }

        if (
          data &&
          data.substr(0, 10) === APPROVE_FUNCTION_SIGNATURE &&
          (!value || isZeroValue(value))
        ) {
          setTransactionModalType(TransactionModalType.Transaction);
        } else {
          setTransactionModalType(TransactionModalType.Dapp);
        }
      }
    },
    [
      props.chainId,
      props.tokens,
      autoSign,
      setTransactionObject,
      tokenList,
      setEtherTransaction,
    ],
  );

  const renderQRSigningModal = () => {
    const { isSigningQRObject, QRState } = props;
    const shouldRenderThisModal = !showPendingApproval && isSigningQRObject;
    return (
      shouldRenderThisModal && (
        <QRSigningModal isVisible={isSigningQRObject} QRState={QRState} />
      )
    );
  };

  const onSwitchChainConfirm = (customNetworkData) => {
    props.networkSwitched({
      networkUrl: customNetworkData.rpcUrl,
      networkStatus: true,
    });
  };

  // unapprovedTransaction effect
  useEffect(() => {
    Engine.context.TransactionController.hub.on(
      'unapprovedTransaction',
      onUnapprovedTransaction,
    );
    return () => {
      Engine.context.TransactionController.hub.removeListener(
        'unapprovedTransaction',
        onUnapprovedTransaction,
      );
    };
  }, [onUnapprovedTransaction]);

  const handlePendingApprovals = async (approval) => {
    //TODO: IF WE RECEIVE AN APPROVAL REQUEST, AND WE HAVE ONE ACTIVE, SHOULD WE HIDE THE CURRENT ONE OR NOT?

    if (approval.pendingApprovalCount > 0) {
      const key = Object.keys(approval.pendingApprovals)[0];
      const request = approval.pendingApprovals[key];
      const requestData = { ...request.requestData };

      switch (request.type) {
        case ApprovalTypes.REQUEST_PERMISSIONS:
          if (requestData?.permissions?.eth_accounts) {
            const {
              metadata: { id },
            } = requestData;

            const totalAccounts = props.accountsLength;

            AnalyticsV2.trackEvent(MetaMetricsEvents.CONNECT_REQUEST_STARTED, {
              number_of_accounts: totalAccounts,
              source: 'PERMISSION SYSTEM',
            });

            props.navigation.navigate(
              ...createAccountConnectNavDetails({
                hostInfo: requestData,
                permissionRequestId: id,
              }),
            );
          }
          break;
        case ApprovalTypes.TRANSACTION:
          showPendingApprovalModal({
            type: ApprovalTypes.TRANSACTION,
            origin: request.origin,
          });
          break;
        default:
          break;
      }
    } else {
      setShowPendingApproval(false);
    }
  };

  useEffect(() => {
    initializeWalletConnect();

    Engine.controllerMessenger.subscribe(
      'ApprovalController:stateChange',
      handlePendingApprovals,
    );

    return function cleanup() {
      Engine.context.TokensController.hub.removeAllListeners();
      Engine.controllerMessenger.unsubscribe(
        'ApprovalController:stateChange',
        handlePendingApprovals,
      );
      WalletConnect.hub.removeAllListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <React.Fragment>
      <SignatureApproval />
      <WalletConnectApproval />
      <TransactionApproval
        navigation={props.navigation}
        transactionType={transactionModalType}
      />
      <AddChainApproval />
      <SwitchChainApproval onConfirm={onSwitchChainConfirm} />
      <WatchAssetApproval />
      {renderQRSigningModal()}
      <ConnectApproval navigation={props.navigation} />
    </React.Fragment>
  );
};

RootRPCMethodsUI.propTypes = {
  swapsTransactions: PropTypes.object,
  /**
   * Object that represents the navigator
   */
  navigation: PropTypes.object,
  /**
   * Action that sets an ETH transaction
   */
  setEtherTransaction: PropTypes.func,
  /**
   * Action that sets a transaction
   */
  setTransactionObject: PropTypes.func,
  /**
   * Array of ERC20 assets
   */
  tokens: PropTypes.array,
  /**
   * Selected address
   */
  selectedAddress: PropTypes.string,
  /**
   * Chain id
   */
  chainId: PropTypes.string,
  isSigningQRObject: PropTypes.bool,
  QRState: PropTypes.object,
  /**
   * updates redux when network is switched
   */
  networkSwitched: PropTypes.func,
  accountsLength: PropTypes.number,
};

const mapStateToProps = (state) => ({
  selectedAddress:
    state.engine.backgroundState.PreferencesController.selectedAddress,
  chainId: selectChainId(state),
  tokens: state.engine.backgroundState.TokensController.tokens,
  swapsTransactions:
    state.engine.backgroundState.TransactionController.swapsTransactions || {},
  providerType: selectProviderType(state),
  accountsLength: Object.keys(
    state.engine.backgroundState.AccountTrackerController.accounts || {},
  ).length,
});

const mapDispatchToProps = (dispatch) => ({
  setEtherTransaction: (transaction) =>
    dispatch(setEtherTransaction(transaction)),
  setTransactionObject: (transaction) =>
    dispatch(setTransactionObject(transaction)),
  networkSwitched: ({ networkUrl, networkStatus }) =>
    dispatch(networkSwitched({ networkUrl, networkStatus })),
});

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(withQRHardwareAwareness(RootRPCMethodsUI));
