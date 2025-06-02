import type {TranslationMessages} from 'react-admin';

// @ts-expect-error
export const customEnglishMessages: TranslationMessages = {
    name: 'Security |||| Security',
    notify: {
        saveSuccess: 'Public key and name saved successfully!',
        saveError: 'Error saving data',
        fillFields: 'Please fill in all fields',
        saveNameSuccess: 'Name saved successfully.',
        generateKeySuccess: 'New key pair generated. Please save your private key securely.',
        generateKeyError: 'Key pair generation failed',
        saveKeySuccess: 'Key pair saved successfully.',
        deleteKeySuccess: 'Key pair deleted successfully.',
        deleteKeyError: 'Failed to delete key pair',
        generateFirstWarning: 'Please generate a key pair first.'
    }
};
