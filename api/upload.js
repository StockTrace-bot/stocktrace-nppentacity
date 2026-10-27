const { google } = require('googleapis');
const { Readable } = require('stream');
const formidable = require('formidable');
const fs = require('fs');

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const form = formidable();
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Gagal memproses file.' });

    const file = files.bukti_file;
    const idKasus = fields.id_kasus[0];

    try {
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      });

      const drive = google.drive({ version: 'v3', auth });
      const FOLDER_UTAMA_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
      const fileStream = fs.createReadStream(file[0].filepath);
      
      const fileMetadata = {
        name: `${idKasus}_${file[0].originalFilename}`,
        parents: [FOLDER_UTAMA_ID],
      };

      const media = {
        mimeType: file[0].mimetype,
        body: fileStream,
      };

      const driveResponse = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, webViewLink',
      });

      fs.unlinkSync(file[0].filepath);

      return res.status(200).json({
        success: true,
        drive_file_id: driveResponse.data.id,
        drive_link: driveResponse.data.webViewLink,
      });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Gagal mengunggah ke Google Drive' });
    }
  });
}