import { ASPECT_RATIOS, IMAGE_MODELS } from '../flow.js';

export const toolDefinitions = [
  {
    name: 'generate_image',
    description:
      'Generate an image using Google Labs Flow (Nano Banana 2/Pro or Imagen 4). ' +
      'Returns absolute file paths to the saved images. Requires an active Google session ' +
      '(run `npx flow-api login` once first to authenticate).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Text prompt describing the image to generate.',
        },
        model: {
          type: 'string',
          enum: IMAGE_MODELS.map((m) => m.id),
          description: 'Image model id. Defaults to "nano-banana-2" if omitted.',
          default: 'nano-banana-2',
        },
        aspect_ratio: {
          type: 'string',
          enum: ASPECT_RATIOS,
          description: 'Aspect ratio. Defaults to whatever Flow selects if omitted.',
        },
        output_dir: {
          type: 'string',
          description: 'Override output directory for this generation.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'flow_status',
    description:
      'Check whether the Google Flow session is valid and the browser is ready. ' +
      'Returns { loggedIn, url, reason, uptimeSec, models, aspectRatios }.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'flow_login',
    description:
      'Open a visible Chromium window so the user can sign in to Google. ' +
      'After signing in, the session is persisted in the local Chrome profile for future calls. ' +
      'This is a one-time setup step. Closes the browser window when finished.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout_sec: {
          type: 'integer',
          description: 'Max seconds to wait for the user to finish login. Default 300.',
          default: 300,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'flow_close',
    description: 'Close the browser. Useful for freeing memory or resetting state.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

export function textResult(text, isError = false) {
  return {
    content: [{ type: 'text', text }],
    isError,
  };
}

export function jsonResult(obj) {
  return textResult(JSON.stringify(obj, null, 2));
}
