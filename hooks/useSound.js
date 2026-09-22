import { useState, useRef } from 'react';
import { Alert } from 'react-native';
import Sound from 'react-native-sound';
import { UserMessages } from '../utils/userMessages';

export const useSound = () => {
  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const playMp3FromAssets = () => {
    if (isPlaying) {
      console.log('Sound is already playing.');
      return;
    }

    const soundFilePath = 'high_pitched_ringing.wav';
    console.log('Playing Sound in Infinite Loop');

    const newSound = new Sound(soundFilePath, Sound.MAIN_BUNDLE, error => {
      if (error) {
        Alert.alert('Error', UserMessages.soundLoadFailed);
        return;
      }

      setSound(newSound);
      setIsPlaying(true);

      const playLoop = () => {
        newSound.play(success => {
          if (success) {
            console.log('Replaying Sound');
            playLoop();
          } else {
            console.log('Playback failed');
            stopSound();
          }
        });
      };

      playLoop();
    });
  };

  const stopSound = () => {
    if (sound) {
      sound.stop(() => {
        console.log('Sound stopped');
        sound.release();
        setSound(null);
        setIsPlaying(false);
      });
    } else {
      console.log('No sound is playing.');
    }
  };

  return {
    sound,
    isPlaying,
    playMp3FromAssets,
    stopSound
  };
};
