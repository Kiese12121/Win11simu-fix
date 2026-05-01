import https from 'https';
https.get('https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const match = data.match(/href="(debian-\d+\.\d+\.\d+-amd64-netinst\.iso)"/);
    if (match) {
      console.log(match[1]);
    } else {
      console.log("Not found");
    }
  });
});
