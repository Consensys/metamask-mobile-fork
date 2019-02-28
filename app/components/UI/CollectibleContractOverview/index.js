import React, { Component } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import PropTypes from 'prop-types';
import { colors, fontStyles } from '../../../styles/common';
import { strings } from '../../../../locales/i18n';
import CollectibleImage from '../CollectibleImage';
import AssetActionButtons from '../AssetActionButtons';
import { setCollectibleContractTransaction } from '../../../actions/transaction';
import { connect } from 'react-redux';

const styles = StyleSheet.create({
	wrapper: {
		flex: 1,
		paddingHorizontal: 20,
		borderBottomWidth: StyleSheet.hairlineWidth,
		borderBottomColor: colors.borderColor,
		alignContent: 'center',
		alignItems: 'center',
		paddingBottom: 30
	},
	assetLogo: {
		marginTop: 20
	},
	information: {
		flex: 1,
		flexDirection: 'row',
		marginTop: 10
	},
	name: {
		fontSize: 30,
		color: colors.fontPrimary,
		...fontStyles.normal
	}
});

/**
 * View that displays a specific collectible contract
 * including the overview (name, address, symbol, logo, description, total supply)
 */
class CollectibleContractOverview extends Component {
	static propTypes = {
		/**
		 * Object that represents the asset to be displayed
		 */
		collectibleContract: PropTypes.object,
		/**
		 * Array of ERC721 assets
		 */
		collectibles: PropTypes.array,
		/**
		 * Navigation object required to push
		 * the Asset detail view
		 */
		navigation: PropTypes.object,
		/**
		 * How many collectibles are owned by the user
		 */
		ownerOf: PropTypes.number,
		/**
		 * Action that sets a collectible contract type transaction
		 */
		setCollectibleContractTransaction: PropTypes.func.isRequired
	};

	onAdd = () => {
		this.props.navigation.push('AddAsset', { assetType: 'collectible' });
	};

	onSend = () => {
		const { collectibleContract, collectibles } = this.props;
		const collectible = collectibles.find(
			collectible => collectible.address.toLowerCase() === collectibleContract.address.toLowerCase()
		);
		this.props.setCollectibleContractTransaction(collectible);
		this.props.navigation.navigate('SendView');
	};

	renderLogo = () => {
		const {
			collectibleContract: { logo, address }
		} = this.props;
		return <CollectibleImage collectible={{ address, image: logo }} />;
	};

	render() {
		const {
			collectibleContract: { name },
			ownerOf
		} = this.props;
		return (
			<View style={styles.wrapper}>
				<View style={styles.assetLogo}>{this.renderLogo()}</View>
				<View style={styles.information}>
					<Text style={styles.name}>
						{ownerOf} {name}
					</Text>
				</View>

				<AssetActionButtons
					leftText={strings('asset_overview.send_button')}
					rightText={strings('asset_overview.add_collectible_button')}
					onRightPress={this.onAdd}
					onLeftPress={this.onSend}
				/>
			</View>
		);
	}
}

const mapStateToProps = state => ({
	collectibles: state.engine.backgroundState.AssetsController.collectibles
});

const mapDispatchToProps = dispatch => ({
	setCollectibleContractTransaction: collectible => dispatch(setCollectibleContractTransaction(collectible))
});

export default connect(
	mapStateToProps,
	mapDispatchToProps
)(CollectibleContractOverview);
