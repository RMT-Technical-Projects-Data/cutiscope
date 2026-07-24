import React from "react";
import { Text, View } from "react-native";
import { styles } from "../styles/cameraScreenStyles";

const MillimeterScale = ({ zoom }) => {
  const maxMm = 15.0 / zoom;
  const totalSteps = Math.floor(maxMm * 10);
  const ticks = [];
  for (let i = 0; i <= totalSteps; i++) {
    ticks.push(i / 10);
  }

  return (
    <View style={styles.mmScaleContainer}>
      <View style={styles.mmScaleLine} />
      {ticks.map((val, index) => {
        const valRounded = Math.round(val * 10);
        const isMajor = valRounded % 10 === 0;
        const isMedium = valRounded % 10 === 5;
        const topPosition = `${((maxMm - val) / maxMm) * 100}%`;

        let tickStyle = styles.mmScaleTickMinor;
        if (isMajor) {
          tickStyle = styles.mmScaleTickMajor;
        } else if (isMedium) {
          tickStyle = styles.mmScaleTickMedium;
        }

        return (
          <View key={index} style={[styles.mmScaleTickRow, { top: topPosition }]}>
            <View style={tickStyle} />
            {isMajor && (
              <Text style={styles.mmScaleText}>
                {val.toFixed(0)}
              </Text>
            )}
          </View>
        );
      })}
      <Text style={styles.mmScaleUnit}>mm</Text>
    </View>
  );
};

export default MillimeterScale;
