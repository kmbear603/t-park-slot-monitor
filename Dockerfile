FROM node:10
ADD package.json /
ADD program.js /
RUN npm install
CMD [ "node", "./program.js" ]
