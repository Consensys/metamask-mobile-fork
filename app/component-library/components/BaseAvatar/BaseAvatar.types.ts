import { ViewProps } from 'react-native';

/**
 * BaseAvatar Avatar sizes
 */
export enum BaseAvatarSize {
  Xs = '16',
  Sm = '24',
  Md = '32',
  Lg = '40',
  Xl = '48',
}

/**
 * Avatar badge possible placement.
 */
export enum AvatarBadgePosition {
  TopRight = 'top-right',
  BottomRight = 'bottom-right',
}

/**
 * BaseAvatar component props.
 */
export interface BaseAvatarProps extends ViewProps {
  /**
   * Enum to select between Avatar sizes.
   */
  size: BaseAvatarSize;
  /**
   * Boolean that decides if the badge gets rendered or not.
   */
  showBadge?: boolean;
  /**
   * Enum to select the badge position.
   */
  badgePosition?: AvatarBadgePosition;
  /**
   * Badge component.
   */
  badgeComponent: JSX.Element;
}

/**
 * Style sheet input parameters.
 */
export type BaseAvatarStyleSheetVars = Pick<BaseAvatarProps, 'size' | 'style'>;
