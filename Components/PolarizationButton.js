import React from 'react';
import { TouchableOpacity, Image } from 'react-native';
import { usePolarization } from '../hooks/usePolarization';
import PolIcon from '../assets/icon_linear_pol.png';

const PolarizationButton = ({ onStateChange, ToastAndroid }) => {
  const {
    isPolPressed,
    handlePolarizationBtn,
    stopPolarization
  } = usePolarization();

  const simpleToast = (textAlign) => {
    if (textAlign === "Switching OFF Polarization") {
      ToastAndroid.showWithGravityAndOffset(
        `${textAlign}`,
        ToastAndroid.LONG,
        ToastAndroid.BOTTOM,
        0,
        550,
      );
    } else {
      ToastAndroid.showWithGravityAndOffset(
        `${textAlign}`,
        ToastAndroid.LONG,
        ToastAndroid.BOTTOM,
        0,
        550,
      );
    }
  };

  const handlePress = () => {
    handlePolarizationBtn();
    simpleToast("POLARIZATION");
    if (onStateChange) {
      onStateChange(isPolPressed);
    }
  };

  const handleLongPress = () => {
    stopPolarization();
    simpleToast("Switching OFF Polarization");
    if (onStateChange) {
      onStateChange(null);
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={handleLongPress}
      activeOpacity={1}
      style={styles.menuItemPol}
    >
      <Image
        source={PolIcon}
        style={[
          styles.icon,
          isPolPressed === 'Polarization' && {
            tintColor: 'white',
            backgroundColor: 'grey',
            borderRadius: 50,
            padding: 20
          },
          isPolPressed === 'CrossPolarization' && {
            tintColor: '#000000',
            backgroundColor: '#22B2A6',
            borderRadius: 50,
            padding: 20
          },
        ]}
      />
    </TouchableOpacity>
  );
};

const styles = {
  menuItemPol: {
    position: 'absolute',
    bottom: '15%',
    right: '22.5%',
    elevation: 20,
    shadowColor: '#000',
    borderRadius: 20,
  },
  icon: {
    width: 45,
    height: 45,
    elevation: 20,
    shadowColor: '#000',
    borderRadius: 20,
  },
};

export default PolarizationButton;